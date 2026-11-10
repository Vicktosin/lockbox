import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { rmSync, readFileSync, existsSync } from 'node:fs'
import { GoogleFixture } from './google-drive-fixture.mjs'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import { initializeKeyFile, loadKeyFile } from '../server/security/key-file.ts'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { createBackendApp } from '../server/http/app.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import { createSealer } from '../server/drive/security.ts'
import { createRecoveryAssistant } from '../server/maintenance/recovery-assistant.ts'
import { loadRestoredDeployment } from '../server/config/deployment.ts'
import { VaultEngine } from '../src/features/vault/engine.ts'
import { emergencyKeyPath } from '../server/maintenance/complete.ts'
const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-rehearsal-' + randomUUID()),
  original = join(root, 'lost-server'),
  target = join(root, 'new-server')
ensurePrivateDirectory(root)
const config = {
  dbPath: join(original, 'db', 'app.sqlite'),
  keyFile: join(original, 'keys', 'app.json'),
  backupDirectory: join(original, 'backups'),
  origin: 'http://localhost:5173',
}
initializeDatabase(config.dbPath)
let db = openInitializedDatabase(config.dbPath)
initializeKeyFile(db, config.keyFile)
const google = new GoogleFixture(),
  application = {
    clientId: 'fictional-client.apps.googleusercontent.com',
    clientSecret: 'fictional-client-secret',
    redirectUri: config.origin + '/api/drive/callback',
  },
  backupFolder = '1PrivateBackupFolderForTests'
let time = Date.now(),
  app,
  assistant,
  admin,
  wife,
  engine,
  partner,
  kit,
  installationId,
  conflictId,
  archivedId,
  remoteFile,
  remoteHash
const now = () => time,
  password = 'Fictional rehearsal login passphrase!',
  next = 'Fictional restored account passphrase!',
  active = []
const masters = {
  RehearsalAdmin: 'Fictional separate administrator master!',
  RehearsalWife: 'Fictional independent partner master!',
}
function makeApp(database, cfg) {
  return createBackendApp(undefined, () => {}, {
    db: database,
    origin: config.origin,
    production: false,
    vaults: true,
    now,
    drive: {
      keys: loadKeyFile(cfg.keyFile),
      application,
      fetch: google.fetch,
      sleep: async () => {},
      background: false,
      now,
    },
    maintenance: {
      config: cfg,
      secrets: {
        googleClientId: application.clientId,
        googleClientSecret: application.clientSecret,
      },
      background: false,
      now,
    },
  })
}
app = makeApp(db, config)
function cleanup(path) {
  if (!resolve(path).startsWith(resolve(parent) + sep))
    throw new Error('Unsafe test cleanup')
  rmSync(path, { recursive: true, force: true })
}
async function request(account, url, body, targetApp = app, extra = {}) {
  return targetApp.inject({
    url,
    method: body ? 'POST' : 'GET',
    headers: {
      origin: config.origin,
      ...(account
        ? { cookie: account.cookie, 'x-csrf-token': account.csrf }
        : {}),
      ...extra,
    },
    ...(body ? { payload: body } : {}),
  })
}
async function login(name, pass = password) {
  const r = await request(null, '/api/auth/login', {
    username: name,
    password: pass,
  })
  assert.equal(r.statusCode, 200, r.body)
  const a = {
    id: r.json().user.id,
    username: name,
    cookie: String(r.headers['set-cookie']).split(';')[0],
    csrf: r.json().csrfToken,
  }
  a.api = async (path, body) => {
    const r = await request(a, '/api/vault/' + path, body)
    assert.equal(r.statusCode, 200, r.body)
    return r.json()
  }
  return a
}
async function account(name, role) {
  const invite = issueRegistrationInvite(db, role, time)
  assert.equal(
    (
      await request(null, '/api/auth/register', {
        username: name,
        password,
        passwordConfirmation: password,
        inviteCode: invite.inviteCode,
      })
    ).statusCode,
    201,
  )
  const a = await login(name)
  const draft = await VaultEngine.prepare(a.id, masters[name], masters[name])
  a.vaultCode = draft.recoveryCode
  const vault = await VaultEngine.finishSetup(
    a.api,
    a.id,
    draft,
    draft.recoveryCode,
  )
  active.push(vault)
  a.code = (
    await request(a, '/api/auth/recovery-code', { password })
  ).json().code
  return [a, vault]
}
async function connect(a) {
  const begin = await request(a, '/api/drive/connect', {
    folderLink: 'https://drive.google.com/drive/folders/' + google.folderId,
  })
  assert.equal(begin.statusCode, 200, begin.body)
  const state = new URL(begin.json().authorizationUrl).searchParams.get('state')
  const callback = await request(
    a,
    '/api/drive/callback?state=' + state + '&code=fictional-fresh-consent',
  )
  assert.equal(callback.statusCode, 302, callback.body)
}
async function backup() {
  const r = await request(admin, '/api/maintenance/backup', {})
  assert.equal(r.statusCode, 200, r.body)
  return r.json()
}
const credential = (name, vault = 'personal', owner = 'emmanuel') => ({
  name,
  url: 'https://example.test',
  username: 'fictional-user',
  password: 'FICTIONAL-' + name + '-PASSWORD',
  notes: 'fictional test only',
  category: 'Personal',
  vault,
  owner,
})
try {
  await test('rehearsal provisions two independent client-encrypted vaults and Household, login recovery and real mocked OAuth', async () => {
    ;[admin, engine] = await account('RehearsalAdmin', 'administrator')
    ;[wife, partner] = await account('RehearsalWife', 'member')
    await engine.saveCredential(credential('admin-private'))
    await partner.saveCredential(
      credential('wife-private', 'personal', 'partner'),
    )
    await engine.createHousehold()
    await engine.grantHousehold(wife.id)
    await partner.refresh()
    await partner.joinHousehold(engine.exportHousehold())
    await engine.saveCredential(credential('household', 'shared'))
    await engine.saveCredential(credential('recover-deleted'))
    const deleted = engine.credentials.find((x) => x.name === 'recover-deleted')
    await engine.deleteCredential(deleted.id)
    await connect(admin)
    assert.equal((await request(admin, '/api/drive/sync', {})).statusCode, 200)
    installationId = db
      .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
      .get().value
    conflictId = randomUUID()
    db.prepare(
      'INSERT INTO drive_conflicts(id,folder_id,created_at,sealed,resolved_at) VALUES(?,?,?,?,?)',
    ).run(
      conflictId,
      google.folderId,
      time,
      createSealer(loadKeyFile(config.keyFile), installationId).seal(
        { fixture: 'fictional closed conflict history' },
        'conflict:' + conflictId,
      ),
      time,
    )
    kit = readFileSync(emergencyKeyPath(config), 'utf8').trim()
  })
  await test('off-device setup rejects shared folder, missing custody proof, cross-account access and absent CSRF', async () => {
    const body = {
      folderLink: 'https://drive.google.com/drive/folders/' + backupFolder,
      keyConfirmation: kit,
      password,
    }
    assert.equal(
      (await request(wife, '/api/maintenance/destination', body)).statusCode,
      403,
    )
    assert.equal(
      (
        await request(admin, '/api/maintenance/destination', body, app, {
          'x-csrf-token': 'wrong',
        })
      ).statusCode,
      403,
    )
    assert.notEqual(
      (
        await request(admin, '/api/maintenance/destination', {
          ...body,
          keyConfirmation: 'A'.repeat(43),
        })
      ).statusCode,
      200,
    )
    assert.notEqual(
      (
        await request(admin, '/api/maintenance/destination', {
          ...body,
          folderLink:
            'https://drive.google.com/drive/folders/' + google.folderId,
        })
      ).statusCode,
      200,
    )
  })
  await test('automatic backup delivery downloads, authenticates and restores encrypted remote bytes before recording success', async () => {
    db.prepare('UPDATE vault_history SET saved_at=?').run(time - 100 * 86400000)
    const r = await request(admin, '/api/maintenance/destination', {
      folderLink: 'https://drive.google.com/drive/folders/' + backupFolder,
      keyConfirmation: kit,
      password,
    })
    assert.equal(r.statusCode, 200, r.body)
    assert.equal(r.json().offdevice.error, null)
    assert.ok(r.json().offdevice.lastSuccess)
    assert.ok(
      google.requests.some((x) => x.url.includes('uploadType=resumable')),
    )
    for (const file of google.files.values())
      if (file.meta.appProperties.kind === 'backup') {
        assert.ok(!file.sealed.includes(kit))
        assert.ok(!file.sealed.includes(password))
        assert.ok(!file.sealed.includes('admin-private'))
        assert.ok(file.meta.parents.includes(backupFolder))
      }
  })
  await test('compaction preserves deleted-entry recovery, permissions, unique IDs and pinned remote copies', async () => {
    const r = await request(admin, '/api/maintenance/compact', {})
    assert.equal(r.statusCode, 200, r.body)
    assert.ok(r.json().offdevice.archived.n > 0)
    assert.equal(db.prepare('SELECT count(*) n FROM vault_history').get().n, 0)
    const list = (await request(admin, '/api/vault/history')).json().history
    archivedId = list.find((x) => x.scope === 'personal').id
    assert.equal(
      (await request(wife, '/api/vault/history?id=' + archivedId)).statusCode,
      404,
    )
    const previous = (
      await request(admin, '/api/vault/history?id=' + archivedId)
    ).json().vault
    await engine.restoreRevision(previous)
    assert.ok(engine.credentials.some((x) => x.name === 'recover-deleted'))
    const max = db.prepare('SELECT MAX(id) n FROM archived_history').get().n
    assert.ok(db.prepare('SELECT MAX(id) n FROM vault_history').get().n > max)
    const d = db
      .prepare('SELECT backup_id FROM archived_history WHERE id=?')
      .get(archivedId)
    assert.ok(
      db
        .prepare('SELECT verified_at FROM backup_deliveries WHERE backup_id=?')
        .get(d.backup_id).verified_at,
    )
    const pinned = db
      .prepare('SELECT filename FROM backup_runs WHERE id=?')
      .get(d.backup_id).filename
    assert.equal(
      (
        await request(admin, '/api/maintenance/policy', {
          backupDays: 7,
          historyDays: 7,
        })
      ).statusCode,
      200,
    )
    time += 8 * 86400000
    admin = { ...admin, ...(await login(admin.username)) }
    await backup()
    assert.ok(
      existsSync(join(config.backupDirectory, pinned)),
      'Unique archived history keeps its local fallback even after retention expires',
    )
  })
  await test('network delivery failures persist retry state; retries adopt a durably uploaded file after a lost response', async () => {
    const entered = Promise.withResolvers(),
      release = Promise.withResolvers()
    google.beforeCreate = async (meta) => {
      if (meta.appProperties.kind === 'backup') {
        entered.resolve()
        await release.promise
      }
    }
    const upload = backup()
    const deadline = setTimeout(
      () => entered.reject(new Error('Backup did not enter upload')),
      120000,
    )
    deadline.unref()
    try {
      await entered.promise
      assert.equal(
        (await request(admin, '/api/vault/history?id=' + archivedId))
          .statusCode,
        409,
        'Concurrent archive downloads must be bounded while a backup transfer is in progress',
      )
    } finally {
      clearTimeout(deadline)
      release.resolve()
      google.beforeCreate = null
    }
    await upload
    google.failure = () => google.json({ error: { code: 503 } }, 503)
    time += 1
    const failed = await backup()
    assert.ok(failed.offdevice.error)
    assert.ok(failed.offdevice.retryAt)
    google.failure = null
    google.failAfterCreate = true
    time += 60001
    const success = await backup()
    assert.equal(success.offdevice.error, null)
    assert.equal(
      db
        .prepare(
          'SELECT count(*) n FROM backup_deliveries WHERE verified_at IS NULL',
        )
        .get().n,
      0,
    )
    time += 49 * 3600000
    admin = { ...admin, ...(await login(admin.username)) }
    assert.equal(
      (await request(admin, '/api/maintenance/status')).json().offdevice.stale,
      true,
    )
    assert.equal((await backup()).offdevice.stale, false)
    assert.equal((await request(admin, '/api/drive/sync', {})).statusCode, 200)
    await backup()
    const latest = db
      .prepare(
        'SELECT d.file_id,d.digest FROM backup_deliveries d JOIN backup_runs b ON b.id=d.backup_id WHERE d.verified_at IS NOT NULL ORDER BY b.created_at DESC,b.rowid DESC LIMIT 1',
      )
      .get()
    remoteFile = latest.file_id
    remoteHash = latest.digest
  })
  await test('full server loss removes database, keys, local backups and sessions; fresh assistant rejects unauthorized/bootstrap abuse', async () => {
    for (const e of active) e.lock()
    await app.close()
    db.close()
    app = null
    db = null
    cleanup(original)
    assert.equal(existsSync(original), false)
    const origin = 'http://127.0.0.1:18888'
    assistant = createRecoveryAssistant({
      origin,
      target,
      workspace: join(root, 'assistant-workspace'),
      application: { ...application, redirectUri: origin + '/callback' },
      fetch: google.fetch,
    })
    assert.equal(
      (
        await assistant.app.inject({
          url: '/api/status',
          headers: { host: '127.0.0.1:18888' },
        })
      ).statusCode,
      401,
    )
    const boot = await assistant.app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      headers: { host: '127.0.0.1:18888', origin },
      payload: { launch: new URL(assistant.launchUrl).hash.slice(1) },
    })
    assert.equal(boot.statusCode, 200, boot.body)
    assistant.cookie = String(boot.headers['set-cookie']).split(';')[0]
    assistant.csrf = boot.json().csrf
    assistant.request = (url, body, headers = {}) =>
      assistant.app.inject({
        url,
        method: body ? 'POST' : 'GET',
        headers: {
          host: '127.0.0.1:18888',
          origin,
          cookie: assistant.cookie,
          'x-recovery-csrf': assistant.csrf,
          ...headers,
        },
        ...(body ? { payload: body } : {}),
      })
    assert.equal(
      (
        await assistant.request(
          '/api/connect',
          {
            folderLink:
              'https://drive.google.com/drive/folders/' + backupFolder,
            installationId,
          },
          { 'x-recovery-csrf': 'wrong' },
        )
      ).statusCode,
      403,
    )
  })
  await test('clean assistant obtains fresh consent and restores using only remote ciphertext and separately held emergency record', async () => {
    const begin = await assistant.request('/api/connect', {
      folderLink: 'https://drive.google.com/drive/folders/' + backupFolder,
      installationId,
    })
    assert.equal(begin.statusCode, 200, begin.body)
    const state = new URL(begin.json().authorizationUrl).searchParams.get(
      'state',
    )
    assert.equal(
      (
        await assistant.request(
          '/callback?state=' + state + '&code=fictional-clean-install-consent',
        )
      ).statusCode,
      302,
    )
    assert.ok(
      (await assistant.request('/api/backups'))
        .json()
        .files.some((x) => x.id === remoteFile),
    )
    const wrong = await assistant.request('/api/restore', {
      fileId: remoteFile,
      emergencyKey: 'A'.repeat(43),
    })
    assert.equal(wrong.statusCode, 400)
    const good = await assistant.request('/api/restore', {
      fileId: remoteFile,
      emergencyKey: kit,
    })
    assert.equal(good.statusCode, 200, good.body)
    assert.equal(
      google.files.get(remoteFile).meta.appProperties.hash,
      remoteHash,
    )
    assert.equal(
      (
        await assistant.request('/api/restore', {
          fileId: remoteFile,
          emergencyKey: kit,
        })
      ).statusCode,
      400,
    )
    await assistant.app.close()
    assistant = null
  })
  await test('restored accounts recover login and decrypt both Personal vaults and shared Household; revisions/conflicts remain', async () => {
    const env = loadRestoredDeployment({
        LOCKBOX_DEPLOYMENT_FILE: join(target, 'deployment.json'),
      }),
      cfg = {
        dbPath: env.LOCKBOX_DB_PATH,
        keyFile: env.LOCKBOX_KEY_FILE,
        backupDirectory: env.LOCKBOX_BACKUP_DIR,
        origin: env.LOCKBOX_APP_ORIGIN,
      }
    db = openInitializedDatabase(cfg.dbPath)
    app = makeApp(db, cfg)
    assert.equal(
      db.prepare('SELECT tokens FROM drive_connection').get().tokens,
      null,
    )
    assert.ok(
      db.prepare('SELECT 1 FROM drive_conflicts WHERE id=?').get(conflictId),
    )
    assert.ok(db.prepare('SELECT count(*) n FROM archived_history').get().n > 0)
    for (const old of [admin, wife]) {
      const r = await request(null, '/api/auth/recover', {
        username: old.username,
        code: old.code,
        password: next,
        passwordConfirmation: next,
      })
      assert.equal(r.statusCode, 204, r.body)
      const a = await login(old.username, next),
        vault = await VaultEngine.unlock(a.api, a.id, masters[old.username])
      active.push(vault)
      assert.ok(
        vault.credentials.some(
          (x) =>
            x.name ===
            (old.username === 'RehearsalAdmin'
              ? 'admin-private'
              : 'wife-private'),
        ),
      )
      assert.ok(vault.credentials.some((x) => x.name === 'household'))
      assert.ok(
        !vault.credentials.some(
          (x) =>
            x.name ===
            (old.username === 'RehearsalAdmin'
              ? 'wife-private'
              : 'admin-private'),
        ),
      )
      assert.equal(
        (await request(a, '/api/auth/recovery-code', { password: next }))
          .statusCode,
        200,
      )
      if (old.username === 'RehearsalAdmin') {
        admin = a
        engine = vault
      } else {
        wife = a
        partner = vault
      }
    }
  })
  await test('Drive reconnects after replacement; archived history reads and new encrypted saves continue synchronising', async () => {
    await connect(admin)
    assert.equal((await request(admin, '/api/drive/sync', {})).statusCode, 200)
    assert.equal(
      (await request(admin, '/api/vault/history?id=' + archivedId)).statusCode,
      200,
    )
    await engine.saveCredential(credential('after-replacement'))
    assert.equal((await request(admin, '/api/drive/sync', {})).statusCode, 200)
    const status = await backup()
    assert.equal(status.offdevice.error, null)
    assert.ok(status.offdevice.lastSuccess)
  })
} finally {
  for (const e of active) e.lock()
  await assistant?.app.close()
  await app?.close()
  db?.close()
  cleanup(root)
}
