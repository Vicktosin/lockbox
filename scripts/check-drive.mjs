import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { rmSync, readFileSync, readdirSync } from 'node:fs'
import { GoogleFixture } from './google-drive-fixture.mjs'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { initializeKeyFile, loadKeyFile } from '../server/security/key-file.ts'
import { createBackendApp } from '../server/http/app.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import { createLogger } from '../server/logging.ts'
import { createDriveService } from '../server/drive/service.ts'
import { GoogleDriveAdapter } from '../server/drive/provider.ts'
import { createSealer, digest, parseFolder } from '../server/drive/security.ts'
import { loadGoogleApplication } from '../server/drive/config.ts'
import { exportSnapshots } from '../server/drive/snapshots.ts'
import {
  backupDatabase,
  restoreDatabase,
} from '../server/maintenance/backups.ts'
import { VaultEngine } from '../src/features/vault/engine.ts'

const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-drive-test-' + randomUUID()),
  path = join(root, 'db', 'test.sqlite'),
  keyPath = join(root, 'keys', 'server.json')
ensurePrivateDirectory(root)
initializeDatabase(path)
const db = openInitializedDatabase(path)
initializeKeyFile(db, keyPath)
const keys = loadKeyFile(keyPath),
  google = new GoogleFixture(),
  lines = []
let time = Date.now()
const now = () => time,
  origin = 'http://localhost:5173'
const application = {
  clientId: 'fictional-client.apps.googleusercontent.com',
  clientSecret: 'fictional-oauth-client-secret',
  redirectUri: origin + '/api/drive/callback',
}
const options = {
  keys,
  application,
  fetch: google.fetch,
  sleep: async () => {},
  now,
  background: false,
}
const app = createBackendApp(
  createLogger('info', (line) => lines.push(line)),
  () => {},
  { db, origin, production: false, vaults: true, drive: options },
)
const drive = createDriveService(db, options),
  appId = db
    .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
    .get().value,
  sealer = createSealer(keys, appId)
const password = 'Fictional login passphrase for Drive tests!',
  master = 'Fictional private vault master passphrase!'
let admin, wife, engine, partner, cloneDb, cloneApp, cloneDrive, remoteEngine
async function login(
  username,
  role,
  create = true,
  target = app,
  database = db,
) {
  if (create) {
    const invitation = issueRegistrationInvite(database, role, time)
    assert.equal(
      (
        await target.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: { origin },
          payload: {
            username,
            password,
            passwordConfirmation: password,
            inviteCode: invitation.inviteCode,
          },
        })
      ).statusCode,
      201,
    )
  }
  const response = await target.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { username, password },
  })
  assert.equal(response.statusCode, 200, response.body)
  const cookie = String(response.headers['set-cookie']).split(';')[0],
    data = response.json(),
    id = data.user.id,
    sessionId = database
      .prepare(
        'SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1',
      )
      .get(id).id
  const request = (path, body, extra = {}) =>
    target.inject({
      method: body ? 'POST' : 'GET',
      url: path,
      headers: { origin, cookie, 'x-csrf-token': data.csrfToken, ...extra },
      ...(body ? { payload: body } : {}),
    })
  const api = async (path, body) => {
    const response = await request('/api/vault/' + path, body)
    if (response.statusCode !== 200)
      throw Object.assign(new Error(response.json().code), {
        status: response.statusCode,
      })
    return response.json()
  }
  return {
    id,
    cookie,
    csrf: data.csrfToken,
    request,
    api,
    session: { id: sessionId, user: data.user, csrfToken: data.csrfToken },
  }
}
async function connect(account = admin) {
  const begin = await account.request('/api/drive/connect', {
    folderLink: 'https://drive.google.com/drive/folders/' + google.folderId,
  })
  assert.equal(begin.statusCode, 200, begin.body)
  const url = new URL(begin.json().authorizationUrl)
  const callback = await account.request(
    '/api/drive/callback?state=' +
      url.searchParams.get('state') +
      '&code=fictional-code',
  )
  assert.equal(callback.statusCode, 302, callback.body)
  assert.equal(callback.headers.location, '/#/settings')
  return url
}
const draft = (name, vault = 'personal') => ({
  name,
  url: 'https://fictional-drive.example',
  username: 'fictional-private-user',
  password: 'Fictional saved password must stay encrypted!',
  notes: 'Fictional confidential Drive notes',
  category: 'Personal',
  vault,
  owner: 'emmanuel',
})
async function reauthenticate() {
  admin = await login('DriveAdmin', 'administrator', false)
  wife = await login('DrivePartner', 'member', false)
}
try {
  await test('deployment registration is isolated; unavailable registration does not claim connection', async () => {
    assert.equal(loadGoogleApplication({}, origin), null)
    assert.throws(() =>
      loadGoogleApplication({ LOCKBOX_GOOGLE_CLIENT_ID: 'partial' }, origin),
    )
    assert.equal(
      loadGoogleApplication(
        {
          LOCKBOX_GOOGLE_CLIENT_ID: application.clientId,
          LOCKBOX_GOOGLE_CLIENT_SECRET: application.clientSecret,
        },
        origin,
      ).redirectUri,
      application.redirectUri,
    )
    admin = await login('DriveAdmin', 'administrator')
    wife = await login('DrivePartner', 'member')
    const disabled = createDriveService(db, { ...options, application: null })
    assert.equal(disabled.status(admin.session).configured, false)
    assert.equal(disabled.status(admin.session).connected, false)
    await assert.rejects(
      disabled.begin(
        admin.session,
        'https://drive.google.com/drive/folders/' + google.folderId,
      ),
      /NOT_CONFIGURED/,
    )
    await disabled.close()
    assert.equal(
      (
        await wife.request('/api/drive/connect', {
          folderLink:
            'https://drive.google.com/drive/folders/' + google.folderId,
        })
      ).statusCode,
      403,
    )
  })
  await test('folder links are strictly parsed and permissions reject public/non-owned/unwritable folders', async () => {
    const link =
      'https://drive.google.com/drive/folders/' +
      google.folderId +
      '?resourcekey=testResourceKey'
    assert.deepEqual(parseFolder(link), {
      id: google.folderId,
      resourceKey: 'testResourceKey',
    })
    for (const value of [
      'https://drive.google.com.evil/drive/folders/' + google.folderId,
      'http://drive.google.com/drive/folders/' + google.folderId,
      'https://drive.google.com/file/d/' + google.folderId + '/view',
      'https://evil.example/' + google.folderId,
    ])
      assert.throws(() => parseFolder(value))
    const adapter = new GoogleDriveAdapter({
      folderId: google.folderId,
      appId,
      resourceKey: 'testResourceKey',
      fetch: google.fetch,
      sleep: async () => {},
      token: async () => 'fictional-google-access-token',
    })
    assert.equal((await adapter.validateFolder()).id, google.folderId)
    assert.ok(
      google.requests.some(
        (value) =>
          value.headers['x-goog-drive-resource-keys'] ===
          google.folderId + '/testResourceKey',
      ),
    )
    google.folderPublic = true
    await assert.rejects(adapter.validateFolder(), /NOT_PRIVATE/)
    google.folderPublic = false
    google.folderWritable = false
    await assert.rejects(adapter.validateFolder(), /NOT_WRITABLE/)
    google.folderWritable = true
    google.folderOwned = false
    await assert.rejects(adapter.validateFolder(), /NOT_WRITABLE/)
    google.folderOwned = true
  })
  await test('OAuth uses offline code flow, PKCE and expiring session-bound one-use state; tokens are encrypted', async () => {
    const response = await admin.request('/api/drive/connect', {
      folderLink: 'https://drive.google.com/drive/folders/' + google.folderId,
    })
    const url = new URL(response.json().authorizationUrl),
      state = url.searchParams.get('state')
    assert.equal(url.origin, 'https://accounts.google.com')
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('redirect_uri'), application.redirectUri)
    assert.ok(!response.body.includes(application.clientSecret))
    const denied = await wife.request(
      '/api/drive/callback?state=' + state + '&code=fictional-code',
    )
    assert.notEqual(denied.statusCode, 200)
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM drive_oauth_states').get().n,
      1,
    )
    const done = await admin.request(
      '/api/drive/callback?state=' + state + '&code=fictional-code',
    )
    assert.equal(done.statusCode, 302)
    const tokenRequest = google.requests
        .filter((value) => value.url === 'https://oauth2.googleapis.com/token')
        .at(-1),
      params = new URLSearchParams(tokenRequest.body)
    assert.equal(
      createHash('sha256')
        .update(params.get('code_verifier'))
        .digest('base64url'),
      url.searchParams.get('code_challenge'),
    )
    const saved = db.prepare('SELECT tokens FROM drive_connection').get().tokens
    assert.ok(!saved.includes('fictional-google-refresh-token'))
    assert.ok(!saved.includes('fictional-google-access-token'))
    const status = (await admin.request('/api/drive/status')).json()
    assert.equal(status.connected, true)
    assert.equal(status.account, 'fictional-owner@example.test')
    assert.ok(!JSON.stringify(status).includes('refresh'))
    assert.equal(status.lastSync, null)
    const before = google.requests.filter(
      (value) => value.url === 'https://oauth2.googleapis.com/token',
    ).length
    await admin.request(
      '/api/drive/callback?state=' + state + '&code=replayed-code',
    )
    assert.equal(
      google.requests.filter(
        (value) => value.url === 'https://oauth2.googleapis.com/token',
      ).length,
      before,
    )
  })
  await test('encrypted upload covers two personal namespaces and shared Household without plaintext or public permissions', async () => {
    const one = await VaultEngine.prepare(admin.id, master, master)
    engine = await VaultEngine.finishSetup(
      admin.api,
      admin.id,
      one,
      one.recoveryCode,
    )
    const two = await VaultEngine.prepare(
      wife.id,
      master + ' Partner',
      master + ' Partner',
    )
    partner = await VaultEngine.finishSetup(
      wife.api,
      wife.id,
      two,
      two.recoveryCode,
    )
    await engine.createHousehold()
    await engine.grantHousehold(wife.id)
    await partner.refresh()
    await partner.joinHousehold(engine.exportHousehold())
    await engine.saveCredential(draft('Administrator confidential title'))
    await partner.saveCredential({
      ...draft('Partner confidential title'),
      owner: 'partner',
    })
    await engine.saveCredential(draft('Household confidential title', 'shared'))
    await drive.sync()
    const status = drive.status(admin.session)
    assert.ok(status.lastSync)
    assert.equal(status.namespaces.length, 3)
    assert.equal(
      [...google.files.values()].filter(
        (value) => value.meta.appProperties.kind === 'snapshot',
      ).length,
      3,
    )
    for (const file of google.files.values())
      for (const text of [
        master,
        'Administrator confidential title',
        'Partner confidential title',
        'Household confidential title',
        'Fictional saved password must stay encrypted!',
        'Fictional confidential Drive notes',
      ])
        assert.ok(!file.sealed.includes(text))
    assert.ok(
      !google.requests.some(
        (value) => value.url.includes('/permissions') && value.method !== 'GET',
      ),
    )
    const wifeStatus = (await wife.request('/api/drive/status')).json()
    assert.equal(wifeStatus.connected, true)
    assert.equal(wifeStatus.account, null)
    assert.equal(wifeStatus.namespaces.length, 2)
    assert.ok(
      !wifeStatus.namespaces.some(
        (value) => value.namespace === 'personal:' + admin.id,
      ),
    )
    assert.ok(!JSON.stringify(wifeStatus).includes(application.clientSecret))
  })
  await test('cloud adapter supports authenticated retrieval, conditional update/trash and folder confinement', async () => {
    const adapter = new GoogleDriveAdapter({
      folderId: google.folderId,
      resourceKey: null,
      appId,
      fetch: google.fetch,
      sleep: async () => {},
      token: async () => 'fictional-google-access-token',
    })
    const id = await adapter.allocate(),
      sealed = sealer.seal({ ciphertextFixture: true }, 'fixture')
    await adapter.create(
      id,
      'snapshot',
      digest({ ciphertextFixture: true }),
      sealed,
    )
    const current = await adapter.read(id, 'snapshot')
    assert.equal(current.sealed, sealed)
    await assert.rejects(
      adapter.update(id, 'snapshot', sealed, '"wrong"'),
      /PRECONDITION/,
    )
    await adapter.update(id, 'snapshot', sealed, current.etag)
    await assert.rejects(
      adapter.trash(id, 'snapshot', current.etag),
      /PRECONDITION/,
    )
    await adapter.trash(
      id,
      'snapshot',
      (await adapter.read(id, 'snapshot')).etag,
    )
    assert.ok(
      !(await adapter.list('snapshot')).some((value) => value.id === id),
    )
    const other = await adapter.allocate()
    await adapter.create(other, 'snapshot', 'a'.repeat(64), sealed)
    google.files.get(other).meta.parents = ['different_private_folder']
    await assert.rejects(adapter.read(other, 'snapshot'), /OUTSIDE_NAMESPACE/)
  })
  await test('access-token refresh is single-flight and refresh credentials never leave the backend', async () => {
    time += 3600001
    await Promise.all([drive.sync(), drive.sync(), drive.sync()])
    assert.equal(google.refreshes, 1)
    let unauthorized = true
    google.failure = () => {
      if (unauthorized) {
        unauthorized = false
        return google.json({ error: { code: 401 } }, 401)
      }
      return null
    }
    await drive.sync()
    google.failure = null
    assert.equal(google.refreshes, 2)
    const status = (await admin.request('/api/drive/status')).body
    assert.ok(
      !status.includes('fictional-google-access-token') &&
        !status.includes('fictional-google-refresh-token'),
    )
    const row = db.prepare('SELECT tokens FROM drive_connection').get()
    assert.ok(!row.tokens.includes('fictional-google-refresh-token'))
  })
  await test('immutable uploads are idempotent after a lost response and temporary errors retry safely', async () => {
    await engine.saveCredential(draft('Retry-safe encrypted update'))
    google.failAfterCreate = true
    let attempts = 0
    google.failure = (url, method) => {
      if (method === 'GET' && url.pathname.endsWith('/files') && attempts++ < 2)
        return google.json({ error: { code: 503 } }, 503)
      return null
    }
    await drive.sync()
    google.failure = null
    assert.ok(attempts >= 3)
    assert.equal(drive.status(admin.session).error, null)
    const names = [...google.files.values()]
      .filter((value) => value.meta.appProperties.kind === 'commit')
      .map((value) => value.meta.appProperties.hash)
    assert.equal(new Set(names).size, names.length)
  })
  await test('initial download restores encrypted state, invalidates stale sessions and preserves user separation', async () => {
    const clonePath = join(root, 'clone', 'test.sqlite')
    ensurePrivateDirectory(join(root, 'clone'))
    await db.backup(clonePath)
    cloneDb = openInitializedDatabase(clonePath)
    // Simulate an installation with the same account identity/key backup but no local vault documents.
    cloneDb.exec(
      'DELETE FROM client_vault_members; DELETE FROM client_vaults; DELETE FROM client_vault_profiles; DELETE FROM drive_checkpoints; DELETE FROM drive_commit_cache;',
    )
    cloneApp = createBackendApp(undefined, () => {}, {
      db: cloneDb,
      origin,
      production: false,
      vaults: true,
      drive: options,
    })
    cloneDrive = createDriveService(cloneDb, options)
    assert.equal(await cloneDrive.sync(), true)
    assert.equal(
      cloneDb.prepare('SELECT count(*) AS n FROM sessions').get().n,
      0,
    )
    const actor = await login(
      'DriveAdmin',
      'administrator',
      false,
      cloneApp,
      cloneDb,
    )
    remoteEngine = await VaultEngine.unlock(actor.api, actor.id, master)
    assert.ok(
      remoteEngine.credentials.some(
        (value) => value.name === 'Administrator confidential title',
      ),
    )
    const spouseActor = await login(
        'DrivePartner',
        'member',
        false,
        cloneApp,
        cloneDb,
      ),
      spouseVault = await VaultEngine.unlock(
        spouseActor.api,
        spouseActor.id,
        master + ' Partner',
      )
    assert.ok(
      spouseVault.credentials.some(
        (value) => value.name === 'Partner confidential title',
      ),
    )
    assert.ok(
      !spouseVault.credentials.some(
        (value) => value.name === 'Administrator confidential title',
      ),
    )
    spouseVault.lock()
  })
  await test('remote changes download automatically without overwriting newer local edits', async () => {
    await remoteEngine.saveCredential(draft('Cloud-only subsequent update'))
    await cloneDrive.sync()
    assert.equal(await drive.sync(), true)
    await reauthenticate()
    engine.lock()
    engine = await VaultEngine.unlock(admin.api, admin.id, master)
    assert.ok(
      engine.credentials.some(
        (value) => value.name === 'Cloud-only subsequent update',
      ),
    )
  })
  await test('conflicting updates retain both copies and require each account’s approval before resolution', async () => {
    const cloneActor = await login(
      'DriveAdmin',
      'administrator',
      false,
      cloneApp,
      cloneDb,
    )
    remoteEngine.lock()
    remoteEngine = await VaultEngine.unlock(
      cloneActor.api,
      cloneActor.id,
      master,
    )
    await engine.saveCredential(draft('Conflicting local encrypted update'))
    await remoteEngine.saveCredential(
      draft('Conflicting cloud encrypted update'),
    )
    await cloneDrive.sync()
    await assert.rejects(drive.sync(), /CONFLICT/)
    let conflict = drive.status(admin.session).conflict
    assert.ok(conflict)
    const preserved = digest(exportSnapshots(db))
    const approve = await admin.request('/api/drive/resolve', {
      id: conflict.id,
      copy: 'local',
    })
    assert.equal(approve.statusCode, 200, approve.body)
    assert.ok(approve.json().conflict)
    assert.equal(digest(exportSnapshots(db)), preserved)
    let approvalLocked = false
    google.beforeCreate = async (meta) => {
      if (meta.appProperties.kind === 'commit') {
        await assert.rejects(
          drive.resolve(
            admin.session,
            conflict.id,
            conflict.cloudCopies[0].hash,
          ),
          /SYNC_BUSY/,
        )
        approvalLocked = true
      }
    }
    const finish = await wife.request('/api/drive/resolve', {
      id: conflict.id,
      copy: 'local',
    })
    assert.equal(finish.statusCode, 200, finish.body)
    google.beforeCreate = null
    assert.equal(approvalLocked, true)
    assert.equal(finish.json().conflict, null)
    assert.ok(
      [...google.files.values()].some(
        (value) => value.meta.appProperties.kind === 'commit',
      ),
    )
    assert.ok(
      engine.credentials.some(
        (value) => value.name === 'Conflicting local encrypted update',
      ),
    )
  })
  await test('simultaneous cloud writers preserve both immutable heads; cloud resolution needs both owners', async () => {
    await cloneDrive.sync()
    const actor = await login(
      'DriveAdmin',
      'administrator',
      false,
      cloneApp,
      cloneDb,
    )
    remoteEngine.lock()
    remoteEngine = await VaultEngine.unlock(actor.api, actor.id, master)
    await engine.saveCredential(draft('Concurrent branch on this device'))
    await remoteEngine.saveCredential(
      draft('Concurrent branch on other device'),
    )
    let entered = false
    google.beforeCreate = async (meta) => {
      if (meta.appProperties.kind === 'commit' && !entered) {
        entered = true
        await cloneDrive.sync()
      }
    }
    await assert.rejects(drive.sync(), /CONFLICT/)
    google.beforeCreate = null
    const conflict = drive.status(admin.session).conflict
    assert.equal(conflict.cloudCopies.length, 2)
    const remoteHash = JSON.parse(
      cloneDb
        .prepare('SELECT heads FROM drive_checkpoints WHERE folder_id=?')
        .get(google.folderId).heads,
    )[0]
    assert.equal(
      await drive.resolve(admin.session, conflict.id, remoteHash),
      false,
    )
    assert.equal(
      await drive.resolve(wife.session, conflict.id, remoteHash),
      true,
    )
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0)
    await reauthenticate()
    engine.lock()
    engine = await VaultEngine.unlock(admin.api, admin.id, master)
    assert.ok(
      engine.credentials.some(
        (value) => value.name === 'Concurrent branch on other device',
      ),
    )
    assert.ok(
      !engine.credentials.some(
        (value) => value.name === 'Concurrent branch on this device',
      ),
    )
    assert.ok(
      [...google.files.values()].filter(
        (value) =>
          value.meta.appProperties.kind === 'commit' && !value.meta.trashed,
      ).length >= 4,
    )
  })
  await test('concurrent local writes during upload are preserved and become explicit conflicts', async () => {
    await engine.saveCredential(draft('Before concurrent upload'))
    let changed = false
    google.onCreate = async (meta) => {
      if (meta.appProperties.kind === 'commit' && !changed) {
        changed = true
        await engine.saveCredential(draft('Concurrent local edit retained'))
      }
    }
    await assert.rejects(drive.sync(), /CONFLICT/)
    google.onCreate = null
    assert.ok(
      engine.credentials.some(
        (value) => value.name === 'Concurrent local edit retained',
      ),
    )
    const conflict = drive.status(admin.session).conflict
    assert.ok(conflict)
    await drive.resolve(admin.session, conflict.id, 'local')
    await drive.resolve(wife.session, conflict.id, 'local')
    assert.equal(drive.status(admin.session).conflict, null)
  })
  await test('network failure reports retry state without changing local data; permissions are checked again', async () => {
    const before = digest(exportSnapshots(db))
    google.failure = () => {
      throw new Error('Simulated network outage')
    }
    await assert.rejects(drive.sync(), /NETWORK/)
    assert.equal(digest(exportSnapshots(db)), before)
    assert.ok(drive.status(admin.session).retryAt)
    google.failure = null
    await drive.sync()
    assert.equal(drive.status(admin.session).error, null)
    google.folderPublic = true
    await assert.rejects(drive.sync(), /NOT_PRIVATE/)
    google.folderPublic = false
    assert.equal(digest(exportSnapshots(db)), before)
  })
  await test('cloud tampering is rejected without replacing local vaults', async () => {
    const head = JSON.parse(
      db
        .prepare('SELECT heads FROM drive_checkpoints WHERE folder_id=?')
        .get(google.folderId).heads,
    )[0]
    const file = [...google.files.values()].find(
      (value) =>
        value.meta.appProperties.kind === 'commit' &&
        value.meta.appProperties.hash === head,
    )
    const original = file.sealed,
      record = JSON.parse(original),
      tag = Buffer.from(record.tag, 'base64')
    tag[0] ^= 1
    record.tag = tag.toString('base64')
    file.sealed = JSON.stringify(record)
    file.meta.version = String(Number(file.meta.version) + 1)
    const before = digest(exportSnapshots(db))
    await assert.rejects(drive.sync(), /AUTHENTICATION/)
    assert.equal(digest(exportSnapshots(db)), before)
    file.sealed = original
    file.meta.version = String(Number(file.meta.version) + 1)
    await drive.sync()
  })
  await test('OAuth expiry/cancellation, disconnect, revocation and reconnection keep vault data intact', async () => {
    assert.equal(
      (await wife.request('/api/drive/disconnect', {})).statusCode,
      403,
    )
    const before = digest(exportSnapshots(db))
    await drive.disconnect(admin.session)
    assert.equal(drive.status(admin.session).connected, false)
    assert.equal(
      db.prepare('SELECT tokens FROM drive_connection').get().tokens,
      null,
    )
    assert.ok(google.revocations)
    const pending = await drive.begin(
      admin.session,
      'https://drive.google.com/drive/folders/' + google.folderId,
    )
    const state = new URL(pending.authorizationUrl).searchParams.get('state')
    time += 600001
    await assert.rejects(
      drive.callback(admin.session, { state, code: 'expired' }),
      /EXPIRED/,
    )
    const cancelled = await drive.begin(
      admin.session,
      'https://drive.google.com/drive/folders/' + google.folderId,
    )
    await assert.rejects(
      drive.callback(admin.session, {
        state: new URL(cancelled.authorizationUrl).searchParams.get('state'),
        error: 'access_denied',
      }),
      /CANCELLED/,
    )
    await connect()
    assert.equal(drive.status(admin.session).connected, true)
    await drive.sync()
    assert.equal(digest(exportSnapshots(db)), before)
  })
  await test('disconnect during OAuth cannot resurrect a connection and discards issued credentials', async () => {
    await drive.disconnect(admin.session)
    const pending = await drive.begin(
      admin.session,
      'https://drive.google.com/drive/folders/' + google.folderId,
    )
    let release, entered
    const started = new Promise((resolve) => {
        entered = resolve
      }),
      wait = new Promise((resolve) => {
        release = resolve
      })
    google.onToken = async (params) => {
      if (params.get('grant_type') === 'authorization_code') {
        entered()
        await wait
      }
    }
    const callback = drive.callback(admin.session, {
      state: new URL(pending.authorizationUrl).searchParams.get('state'),
      code: 'inflight-code',
    })
    await started
    await drive.disconnect(admin.session)
    release()
    await assert.rejects(callback, /EXPIRED/)
    google.onToken = null
    assert.equal(drive.status(admin.session).connected, false)
    assert.equal(
      db.prepare('SELECT tokens FROM drive_connection').get().tokens,
      null,
    )
    await connect()
    await drive.sync()
  })
  await test('revoked refresh access requires real reauthorisation and never pretends to be connected', async () => {
    time += 3600001
    google.invalidGrant = true
    await assert.rejects(drive.sync(), /RECONNECT_REQUIRED/)
    assert.equal(drive.status(admin.session).state, 'reauth-required')
    assert.equal(drive.status(admin.session).connected, false)
    google.invalidGrant = false
    await connect()
    await drive.sync()
  })
  await test('corrupt token storage can always be disconnected locally without losing vault data', async () => {
    const before = digest(exportSnapshots(db))
    db.prepare("UPDATE drive_connection SET tokens='{}'").run()
    await drive.disconnect(admin.session)
    assert.equal(drive.status(admin.session).connected, false)
    assert.equal(
      db.prepare('SELECT tokens FROM drive_connection').get().tokens,
      null,
    )
    assert.equal(digest(exportSnapshots(db)), before)
    await connect()
    await drive.sync()
  })
  await test('restored backups cannot revive Google tokens, OAuth attempts or stale sync checkpoints', async () => {
    const archive = join(root, 'backups', 'drive.lbbak')
    await backupDatabase(path, keyPath, archive)
    const restoredPath = join(root, 'restored', 'lockbox.sqlite')
    restoreDatabase(archive, keyPath, restoredPath)
    const restored = openInitializedDatabase(restoredPath)
    try {
      assert.equal(
        restored.prepare('SELECT count(*) AS n FROM drive_connection').get().n,
        0,
      )
      assert.equal(
        restored.prepare('SELECT count(*) AS n FROM drive_oauth_states').get()
          .n,
        0,
      )
      assert.equal(
        restored.prepare('SELECT count(*) AS n FROM drive_checkpoints').get().n,
        0,
      )
      assert.equal(
        restored
          .prepare('SELECT count(*) AS n FROM client_vault_profiles')
          .get().n,
        2,
      )
    } finally {
      restored.close()
    }
  })
  await test('automatic scheduling syncs changes and storage/logs contain no plaintext tokens or saved passwords', async () => {
    const automatic = createBackendApp(undefined, () => {}, {
      db,
      origin,
      production: false,
      vaults: true,
      drive: { ...options, background: true },
    })
    await automatic.ready()
    try {
      const actor = await login(
          'DriveAdmin',
          'administrator',
          false,
          automatic,
          db,
        ),
        vault = await VaultEngine.unlock(actor.api, actor.id, master)
      try {
        await vault.saveCredential(
          draft('Automatically synchronised encrypted record'),
        )
        const deadline = Date.now() + 10000
        while (
          drive
            .status(admin.session)
            .namespaces.some((value) => value.lastSync === null)
        ) {
          assert.ok(Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } finally {
        vault.lock()
      }
    } finally {
      await automatic.close()
    }
    const data = Buffer.concat(
      readdirSync(join(root, 'db'))
        .filter((name) => name.startsWith('test.sqlite'))
        .map((name) => readFileSync(join(root, 'db', name))),
    )
    for (const secret of [
      'fictional-google-refresh-token',
      'fictional-google-access-token',
      application.clientSecret,
      master,
      'Fictional saved password must stay encrypted!',
      'Fictional confidential Drive notes',
    ]) {
      assert.ok(!data.includes(Buffer.from(secret)))
      assert.ok(!lines.join('').includes(secret))
    }
    const status = await admin.request('/api/drive/status')
    assert.equal(status.statusCode, 200)
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/drive/status' }))
        .statusCode,
      401,
    )
    assert.equal(
      (await admin.request('/api/drive/sync', {}, { 'x-csrf-token': 'bad' }))
        .statusCode,
      403,
    )
    assert.equal(
      (
        await admin.request('/api/drive/connect', {
          folderLink:
            'https://drive.google.com/drive/folders/' + google.folderId,
          clientSecret: 'not allowed',
        })
      ).statusCode,
      400,
    )
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
  })
} finally {
  engine?.lock()
  partner?.lock()
  remoteEngine?.lock()
  await drive.close()
  await cloneDrive?.close()
  await cloneApp?.close()
  cloneDb?.close()
  await app.close()
  db.close()
  assert.ok(
    resolve(root).startsWith(resolve(parent) + sep) &&
      root.includes('lockbox-drive-test-'),
  )
  rmSync(root, { recursive: true, force: true })
}
