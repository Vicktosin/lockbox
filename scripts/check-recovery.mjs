import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import {
  initializeKeyFile,
  verifyDatabaseKeys,
  loadKeyFile,
  writePrivateNew,
} from '../server/security/key-file.ts'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { createBackendApp } from '../server/http/app.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import {
  createComplete,
  restoreComplete,
  emergencyKeyPath,
} from '../server/maintenance/complete.ts'
import { createMaintenanceService } from '../server/maintenance/service.ts'
import { loadRestoredDeployment } from '../server/config/deployment.ts'
import { VaultEngine } from '../src/features/vault/engine.ts'

const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-recovery-test-' + randomUUID())
ensurePrivateDirectory(root)
const config = {
  dbPath: join(root, 'db', 'test.sqlite'),
  keyFile: join(root, 'keys', 'key.json'),
  backupDirectory: join(root, 'backups'),
  origin: 'http://localhost:5173',
}
initializeDatabase(config.dbPath)
const db = openInitializedDatabase(config.dbPath)
initializeKeyFile(db, config.keyFile)
const logs = [],
  app = createBackendApp(
    (_l, _e, fields) => logs.push(JSON.stringify(fields)),
    () => {},
    { db, origin: config.origin, production: false, vaults: true },
  )
const password = 'Fictional login recovery test passphrase!',
  master = 'Fictional separate master recovery passphrase!',
  replacement = 'Replacement fictional login passphrase!'
let admin, wife, engine, partner, bundle, restoredDb, restoredApp
const active = []
async function account(name, role) {
  const invite = issueRegistrationInvite(db, role)
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { origin: config.origin },
    payload: {
      username: name,
      password,
      passwordConfirmation: password,
      inviteCode: invite.inviteCode,
    },
  })
  assert.equal(r.statusCode, 201, r.body)
  return login(name, password)
}
async function login(username, pass, target = app) {
  const r = await target.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: config.origin },
    payload: { username, password: pass },
  })
  assert.equal(r.statusCode, 200, r.body)
  const auth = {
    id: r.json().user.id,
    cookie: String(r.headers['set-cookie']).split(';')[0],
    csrf: r.json().csrfToken,
    username,
  }
  auth.request = (url, body, headers = {}) =>
    target.inject({
      method: body ? 'POST' : 'GET',
      url,
      headers: {
        origin: config.origin,
        cookie: auth.cookie,
        'x-csrf-token': auth.csrf,
        ...headers,
      },
      ...(body ? { payload: body } : {}),
    })
  auth.api = async (path, body) => {
    const response = await auth.request('/api/vault/' + path, body)
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
  }
  return auth
}
async function setup(auth) {
  const draft = await VaultEngine.prepare(auth.id, master, master),
    engine = await VaultEngine.finishSetup(
      auth.api,
      auth.id,
      draft,
      draft.recoveryCode,
    )
  active.push(engine)
  auth.vaultCode = draft.recoveryCode
  return engine
}
async function issue(auth) {
  const r = await auth.request('/api/auth/recovery-code', { password })
  assert.equal(r.statusCode, 200, r.body)
  return r.json().code
}
async function reset(auth, code, newPassword = replacement, target = app) {
  return target.inject({
    method: 'POST',
    url: '/api/auth/recover',
    headers: { origin: config.origin },
    payload: {
      username: auth.username.toUpperCase(),
      code,
      password: newPassword,
      passwordConfirmation: newPassword,
    },
  })
}
function cleanup() {
  if (!resolve(root).startsWith(resolve(parent) + sep))
    throw new Error('Unsafe cleanup')
  rmSync(root, { recursive: true, force: true })
}
try {
  await test('recovery is session/CSRF/password protected and separate codes belong to each account', async () => {
    admin = await account('RecoveryAdmin', 'administrator')
    wife = await account('RecoveryWife', 'member')
    engine = await setup(admin)
    partner = await setup(wife)
    assert.equal(
      (
        await admin.request(
          '/api/auth/recovery-code',
          { password },
          { 'x-csrf-token': 'wrong' },
        )
      ).statusCode,
      403,
    )
    assert.equal(
      (await admin.request('/api/auth/recovery-code', { password: 'wrong' }))
        .statusCode,
      401,
    )
    admin.code = await issue(admin)
    wife.code = await issue(wife)
    assert.notEqual(admin.code, wife.code)
    const dump = JSON.stringify(
      db.prepare('SELECT * FROM login_recovery').all(),
    )
    assert.ok(!dump.includes(admin.code))
    assert.ok(!dump.includes(wife.code))
    assert.equal((await reset(wife, admin.code)).json().code, 'RECOVERY_FAILED')
  })
  await test('lost login codes can be rotated after reauthentication; old codes and unknown usernames fail generically', async () => {
    const old = admin.code
    admin.code = await issue(admin)
    const bad = await reset(admin, old),
      unknown = await reset({ username: 'NobodyExists' }, old)
    assert.equal(bad.statusCode, 401)
    assert.deepEqual(bad.json(), unknown.json())
  })
  await test('forgotten master recovery retains personal and shared contents for both accounts', async () => {
    await engine.createHousehold()
    await engine.grantHousehold(wife.id)
    await partner.refresh()
    await partner.joinHousehold(engine.exportHousehold())
    const item = {
      name: 'Fictional recovery item',
      url: 'https://example.test',
      username: 'test-only',
      password: 'FICTIONAL-SAVED-CREDENTIAL',
      notes: 'fictional',
      category: 'Personal',
      vault: 'shared',
      owner: 'emmanuel',
    }
    await engine.saveCredential(item)
    for (const [auth, existing] of [
      [admin, engine],
      [wife, partner],
    ]) {
      await existing.refresh()
      const draft = await VaultEngine.prepareRecovery(
        auth.api,
        auth.id,
        auth.vaultCode,
        master,
        master,
      )
      const recovered = await VaultEngine.finishRecovery(
        auth.api,
        auth.id,
        draft,
        draft.recoveryCode,
      )
      active.push(recovered)
      auth.vaultCode = draft.recoveryCode
      assert.equal(recovered.credentials[0].password, item.password)
      if (auth === admin) engine = recovered
      else partner = recovered
    }
  })
  await test('lost vault recovery key can be replaced with master password; old key no longer works', async () => {
    const old = admin.vaultCode
    await assert.rejects(engine.replaceRecovery('wrong', 'REPLACE'))
    admin.vaultCode = await engine.replaceRecovery(master, 'REPLACE')
    assert.throws(() => engine.verifyRecovery(old))
    engine.verifyRecovery(admin.vaultCode)
  })
  await test('encrypted deleted-entry history is isolated and can restore missing entries without losing newer data', async () => {
    const personal = {
      name: 'Fictional personal',
      url: 'https://example.test',
      username: 'test',
      password: 'FICTIONAL-PERSONAL-SECRET',
      notes: '',
      category: 'Personal',
      vault: 'personal',
      owner: 'emmanuel',
    }
    await engine.saveCredential(personal)
    const id = engine.credentials.find((x) => x.vault === 'personal').id
    await engine.deleteCredential(id)
    const history = (await admin.request('/api/vault/history')).json().history
    const entry = history.find((x) => x.scope === 'personal')
    assert.ok(entry)
    assert.equal(
      (await wife.request('/api/vault/history?id=' + entry.id)).statusCode,
      404,
    )
    const record = (
      await admin.request('/api/vault/history?id=' + entry.id)
    ).json().vault
    await engine.restoreRevision(record)
    assert.ok(engine.credentials.some((x) => x.id === id))
    const serialized = JSON.stringify(
      db.prepare('SELECT * FROM vault_history').all(),
    )
    assert.ok(!serialized.includes(personal.password))
  })
  await test('complete backups verify a clean restoration and include keys, configuration, members, history and connection metadata', async () => {
    db.prepare(
      "INSERT INTO drive_connection(id,epoch,owner_id,status,folder_id,folder_name,account_email,tokens) VALUES(1,?,?, 'connected',?,?,?,?)",
    ).run(
      randomUUID(),
      admin.id,
      'fictional-folder-id',
      'Private',
      'fictional@example.test',
      '{}',
    )
    bundle = await createComplete(config, {
      googleClientId: 'fictional-client',
      googleClientSecret: 'fictional-secret',
    })
    const archive = join(config.backupDirectory, bundle.filename),
      bytes = readFileSync(archive)
    for (const secret of [
      master,
      password,
      admin.code,
      'fictional-secret',
      'FICTIONAL-PERSONAL-SECRET',
    ])
      assert.ok(!bytes.includes(Buffer.from(secret)))
    const restored = restoreComplete(
      archive,
      emergencyKeyPath(config),
      join(root, 'clean-install'),
    )
    restoredDb = openInitializedDatabase(restored.dbPath)
    verifyDatabaseKeys(restoredDb, loadKeyFile(restored.keyFile))
    assert.equal(
      restoredDb.prepare('SELECT count(*) n FROM client_vault_members').get().n,
      2,
    )
    assert.equal(
      restoredDb.prepare('SELECT count(*) n FROM vault_history').get().n,
      db.prepare('SELECT count(*) n FROM vault_history').get().n,
    )
    assert.equal(
      restoredDb.prepare('SELECT tokens FROM drive_connection').get().tokens,
      null,
    )
    assert.equal(
      restoredDb.prepare('SELECT status FROM drive_connection').get().status,
      'reauth-required',
    )
    assert.equal(
      restoredDb.prepare('SELECT count(*) n FROM sessions').get().n,
      0,
    )
    const env = loadRestoredDeployment({
      LOCKBOX_DEPLOYMENT_FILE: join(root, 'clean-install', 'deployment.json'),
    })
    assert.equal(env.LOCKBOX_GOOGLE_CLIENT_SECRET, 'fictional-secret')
    restoredApp = createBackendApp(undefined, () => {}, {
      db: restoredDb,
      origin: config.origin,
      production: false,
      vaults: true,
    })
  })
  await test('restored accounts recover login with saved codes and unlock both vaults without re-encryption', async () => {
    const original = db
      .prepare('SELECT payload FROM client_vaults ORDER BY id')
      .all()
    for (const auth of [admin, wife]) {
      assert.equal(
        (await reset(auth, auth.code, replacement, restoredApp)).statusCode,
        204,
      )
      const signed = await login(auth.username, replacement, restoredApp)
      const unlocked = await VaultEngine.unlock(signed.api, signed.id, master)
      active.push(unlocked)
      assert.ok(unlocked.credentials.some((x) => x.vault === 'shared'))
      assert.equal(
        (await reset(auth, auth.code, replacement, restoredApp)).statusCode,
        401,
      )
    }
    assert.deepEqual(
      restoredDb.prepare('SELECT payload FROM client_vaults ORDER BY id').all(),
      original,
    )
  })
  await test('tampered archives, wrong emergency keys and nonempty targets fail closed', () => {
    const archive = join(config.backupDirectory, bundle.filename),
      tampered = join(root, 'bad.lbx'),
      item = JSON.parse(readFileSync(archive, 'utf8'))
    item.ciphertext =
      (item.ciphertext[0] === 'A' ? 'B' : 'A') + item.ciphertext.slice(1)
    writePrivateNew(tampered, JSON.stringify(item))
    assert.throws(() =>
      restoreComplete(
        tampered,
        emergencyKeyPath(config),
        join(root, 'bad-target'),
      ),
    )
    const wrong = join(root, 'wrong', 'key')
    writePrivateNew(wrong, 'A'.repeat(43) + '\n')
    assert.throws(() =>
      restoreComplete(archive, wrong, join(root, 'wrong-target')),
    )
    assert.throws(() =>
      restoreComplete(
        archive,
        emergencyKeyPath(config),
        join(root, 'clean-install'),
      ),
    )
  })
  await test('backup controls enforce administrator, CSRF and fresh password checks', async () => {
    const target = createBackendApp(undefined, () => {}, {
      db,
      origin: config.origin,
      production: false,
      vaults: true,
      maintenance: { config, background: false },
    })
    try {
      assert.equal(
        (await target.inject({ url: '/api/maintenance/status' })).statusCode,
        401,
      )
      assert.equal(
        (
          await target.inject({
            url: '/api/maintenance/status',
            headers: { cookie: wife.cookie },
          })
        ).statusCode,
        403,
      )
      assert.equal(
        (
          await target.inject({
            url: '/api/maintenance/status',
            headers: { cookie: admin.cookie },
          })
        ).statusCode,
        200,
      )
      assert.equal(
        (
          await target.inject({
            method: 'POST',
            url: '/api/maintenance/backup',
            headers: { origin: config.origin, cookie: admin.cookie },
            payload: {},
          })
        ).statusCode,
        403,
      )
      const reveal = await target.inject({
        method: 'POST',
        url: '/api/maintenance/emergency-key',
        headers: {
          origin: config.origin,
          cookie: admin.cookie,
          'x-csrf-token': admin.csrf,
        },
        payload: { password },
      })
      assert.equal(reveal.statusCode, 200)
      assert.equal(
        reveal.json().key,
        readFileSync(emergencyKeyPath(config), 'utf8').trim(),
      )
      const bad = await target.inject({
        method: 'POST',
        url: '/api/maintenance/policy',
        headers: {
          origin: config.origin,
          cookie: admin.cookie,
          'x-csrf-token': admin.csrf,
        },
        payload: { backupDays: 0, historyDays: 90 },
      })
      assert.equal(bad.statusCode, 400)
    } finally {
      await target.close()
    }
  })
  await test('scheduler creates verified backups, retention keeps two copies and unique history, and missing backup keys fail closed', async () => {
    const old = Date.now() - 40 * 86400000,
      filenames = []
    for (let n = 0; n < 3; n++) {
      const filename = 'complete-' + (old + n) + '-' + randomUUID() + '.lbx'
      filenames.push(filename)
      writePrivateNew(
        join(config.backupDirectory, filename),
        readFileSync(join(config.backupDirectory, bundle.filename)),
      )
      db.prepare(
        "INSERT INTO backup_runs(id,created_at,verified_at,filename,status) VALUES(?,?,?,?,'verified')",
      ).run(randomUUID(), old + n, old + n, filename)
    }
    const count = db.prepare('SELECT count(*) n FROM vault_history').get().n
    const maintenance = createMaintenanceService(db, { config, intervalMs: 20 })
    maintenance.setPolicy(7, 7)
    maintenance.start()
    const deadline = Date.now() + 60000
    while (
      (maintenance.status().running ||
        !maintenance.status().backups.some((x) => x.verified_at > old + 3)) &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 50))
    assert.equal(maintenance.status().lastError, null)
    assert.ok(maintenance.status().backups.some((x) => x.verified_at > old + 3))
    await maintenance.close()
    assert.equal(
      filenames.filter((x) => existsSync(join(config.backupDirectory, x)))
        .length,
      1,
    )
    assert.equal(
      db.prepare('SELECT count(*) n FROM vault_history').get().n,
      count,
    )
    const key = emergencyKeyPath(config),
      saved = readFileSync(key)
    rmSync(key)
    try {
      assert.throws(
        () => createMaintenanceService(db, { config }),
        (e) => e.code === 'RECOVERY_KEY_MISSING',
      )
    } finally {
      writePrivateNew(key, saved)
      saved.fill(0)
    }
  })
  await test('password reset consumes its code atomically, revokes sessions and preserves encrypted records', async () => {
    const before = db
      .prepare('SELECT * FROM client_vault_profiles ORDER BY user_id')
      .all()
    assert.equal((await reset(admin, admin.code)).statusCode, 204)
    assert.equal((await admin.request('/api/auth/me')).statusCode, 401)
    assert.equal((await reset(admin, admin.code)).statusCode, 401)
    assert.deepEqual(
      db.prepare('SELECT * FROM client_vault_profiles ORDER BY user_id').all(),
      before,
    )
  })
  await test('scheduled backups fail visibly when login recovery is missing and never label incomplete recovery successful', async () => {
    const maintenance = createMaintenanceService(db, { config, intervalMs: 10 })
    await maintenance.backup()
    assert.equal(
      maintenance.status().lastError,
      'BACKUP_RECOVERY_CODES_REQUIRED',
    )
    assert.equal(maintenance.status().backups[0].status, 'failed')
    await maintenance.close()
    assert.ok(!JSON.stringify(logs).includes(password))
  })
} finally {
  for (const e of active) e.lock()
  await restoredApp?.close()
  restoredDb?.close()
  await app.close()
  db.close()
  cleanup()
}
