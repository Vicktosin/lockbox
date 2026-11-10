import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID, randomBytes } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
} from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import {
  ensurePrivateDirectory,
  assertPrivate,
} from '../server/security/private-files.ts'
import {
  initializeDatabase,
  openInitializedDatabase,
  migrateDatabase,
  defaultMigrationDirectory,
  verifySchema,
} from '../server/database/migrations.ts'
import {
  initializeKeyFile,
  loadKeyFile,
  verifyDatabaseKeys,
} from '../server/security/key-file.ts'
import {
  backupDatabase,
  restoreDatabase,
} from '../server/maintenance/backups.ts'
import { loadFoundationConfig } from '../server/config/foundation.ts'
import { createBackendApp } from '../server/http/app.ts'
import { createLogger } from '../server/logging.ts'

const testParent = join(process.cwd(), 'server', '.data')
const root = join(testParent, 'lockbox-phase1-' + randomUUID())
ensurePrivateDirectory(root)
const dbPath = join(root, 'db', 'lockbox.sqlite'),
  keyFile = join(root, 'keys', 'key.json')
const code = (expected) => (error) => error?.code === expected
const migrationCount = readdirSync(defaultMigrationDirectory).filter((name) =>
  name.endsWith('.sql'),
).length
const upgradeName = String(migrationCount + 1).padStart(4, '0') + '_failed.sql'
const gapName = String(migrationCount + 2).padStart(4, '0') + '_gap.sql'
const close = (db) => db.close()
function user(db, name, role = 'member', active = 1) {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO users(id,username_display,username_canonical,password_hash,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
  ).run(
    id,
    name,
    name.toLowerCase(),
    'fictional-test-verifier-not-a-password',
    role,
    active,
    1,
    1,
  )
  return id
}
try {
  await test('normal startup refuses missing DB and initialization is repeated without data loss', () => {
    assert.throws(
      () => openInitializedDatabase(dbPath),
      code('DATABASE_MISSING'),
    )
    assert.deepEqual(initializeDatabase(dbPath), {
      created: true,
      applied: migrationCount,
    })
    let db = openInitializedDatabase(dbPath)
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal')
    assert.equal(db.pragma('synchronous', { simple: true }), 2)
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000)
    const id = db
      .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
      .get().value
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0)
    close(db)
    assert.deepEqual(initializeDatabase(dbPath), { created: false, applied: 0 })
    db = openInitializedDatabase(dbPath)
    assert.equal(
      db
        .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
        .get().value,
      id,
    )
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n,
      migrationCount,
    )
    close(db)
  })
  await test('checksums, ordering, pending and newer history fail closed; failed SQL rolls back', () => {
    const dir = join(root, 'migrations')
    mkdirSync(dir)
    const initial = readdirSync(defaultMigrationDirectory)[0]
    for (const name of readdirSync(defaultMigrationDirectory))
      if (name.endsWith('.sql'))
        copyFileSync(join(defaultMigrationDirectory, name), join(dir, name))
    const db = openInitializedDatabase(dbPath)
    try {
      const canonicalSource = readFileSync(join(dir, initial), 'utf8').replace(
        /^\uFEFF/,
        '',
      )
      writeFileSync(
        join(dir, initial),
        '\uFEFF' + canonicalSource.replace(/\r?\n/g, '\r\n'),
      )
      verifySchema(db, dir)
      copyFileSync(join(defaultMigrationDirectory, initial), join(dir, initial))
      writeFileSync(
        join(dir, initial),
        readFileSync(join(dir, initial), 'utf8') + '\n-- modified',
      )
      assert.throws(
        () => verifySchema(db, dir),
        code('MIGRATION_CHECKSUM_MISMATCH'),
      )
      copyFileSync(join(defaultMigrationDirectory, initial), join(dir, initial))
      writeFileSync(
        join(dir, upgradeName),
        'CREATE TABLE should_rollback(id INTEGER); INVALID SQL;',
      )
      assert.throws(() => verifySchema(db, dir), code('MIGRATION_REQUIRED'))
      assert.throws(() => migrateDatabase(db, dir))
      assert.equal(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='should_rollback'",
          )
          .get(),
        undefined,
      )
      assert.equal(
        db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n,
        migrationCount,
      )
      writeFileSync(
        join(dir, upgradeName),
        'CREATE TABLE upgraded_fixture(id INTEGER) STRICT;',
      )
      assert.equal(migrateDatabase(db, dir), 1)
      assert.equal(migrateDatabase(db, dir), 0)
      assert.throws(() => verifySchema(db), code('MIGRATION_HISTORY_INVALID'))
      // This test-only migration is isolated, then removed without touching real migration files.
      db.exec('DROP TABLE upgraded_fixture;')
      db.prepare('DELETE FROM schema_migrations WHERE version=?').run(
        migrationCount + 1,
      )
      rmSync(join(dir, upgradeName))
      writeFileSync(join(dir, gapName), 'SELECT 1;')
      assert.throws(
        () => migrateDatabase(db, dir),
        code('MIGRATION_ORDER_INVALID'),
      )
      verifySchema(db)
    } finally {
      close(db)
    }
  })
  await test('username canonicalization, two-member capacity and FK constraints are enforced', () => {
    const db = openInitializedDatabase(dbPath)
    try {
      const admin = user(db, 'Emmanuel', 'administrator')
      assert.throws(() => user(db, 'EMMANUEL'))
      const wife = user(db, 'Partner')
      assert.throws(() => user(db, 'Third'))
      assert.throws(() =>
        db
          .prepare('UPDATE users SET username_canonical=? WHERE id=?')
          .run('WRONG', wife),
      )
      assert.throws(() =>
        db
          .prepare(
            'INSERT INTO sessions(id,token_digest,user_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(randomUUID(), randomBytes(32), randomUUID(), 1, 1, 5, 10),
      )
      assert.ok(admin && wife)
    } finally {
      close(db)
    }
  })
  await test('key loading and backend key verification fail before explicit creation; initialization is idempotent', () => {
    const db = openInitializedDatabase(dbPath)
    try {
      assert.throws(() => loadKeyFile(keyFile), code('KEY_FILE_MISSING'))
      assert.equal(initializeKeyFile(db, keyFile).created, true)
      const before = readFileSync(keyFile)
      const keys = loadKeyFile(keyFile)
      verifyDatabaseKeys(db, keys)
      assert.equal(initializeKeyFile(db, keyFile).created, false)
      assert.deepEqual(readFileSync(keyFile), before)
      const bad = join(root, 'wrongkeys', 'key.json')
      ensurePrivateDirectory(join(root, 'wrongkeys'))
      writeFileSync(
        bad,
        JSON.stringify({
          format: 'lockbox-server-keys-v1',
          activeVersion: 'v1',
          keys: { v1: randomBytes(32).toString('base64') },
        }),
        { mode: 0o600 },
      )
      assert.throws(
        () => verifyDatabaseKeys(db, loadKeyFile(bad)),
        code('KEY_DATABASE_MISMATCH'),
      )
      assert.throws(
        () => initializeKeyFile(db, join(root, 'lostkeys', 'key.json')),
        code('KEY_FILE_MISSING'),
      )
      assert.ok(!existsSync(join(root, 'lostkeys', 'key.json')))
    } finally {
      close(db)
    }
  })
  await test('malformed keys and unsafe permissions are rejected', () => {
    const dir = join(root, 'malformed')
    ensurePrivateDirectory(dir)
    const file = join(dir, 'key.json')
    for (const contents of [
      '{}',
      'not-json',
      JSON.stringify({
        format: 'lockbox-server-keys-v1',
        activeVersion: 'v1',
        keys: { v1: 'YWJj' },
      }),
    ]) {
      writeFileSync(file, contents, { mode: 0o600 })
      assert.throws(() => loadKeyFile(file))
    }
    if (process.platform !== 'win32') {
      chmodSync(keyFile, 0o644)
      assert.throws(
        () => loadKeyFile(keyFile),
        code('PRIVATE_PERMISSIONS_REQUIRED'),
      )
      chmodSync(keyFile, 0o600)
    }
  })
  await test('Windows key ACL validation rejects an extra read principal', () => {
    if (process.platform !== 'win32') return
    const folder = join(root, 'acltest')
    ensurePrivateDirectory(folder)
    const path = join(folder, 'key.json')
    copyFileSync(keyFile, path)
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$p=$env:LOCKBOX_TEST_ACL_FILE; $a=Get-Acl -LiteralPath $p; $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0'); $r=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow'); $a.AddAccessRule($r); Set-Acl -LiteralPath $p -AclObject $a",
      ],
      {
        env: { ...process.env, LOCKBOX_TEST_ACL_FILE: path },
        windowsHide: true,
        stdio: 'pipe',
      },
    )
    assert.throws(() => loadKeyFile(path), code('PRIVATE_PERMISSIONS_REQUIRED'))
  })
  await test('folder sharing is inherited; mismatched owners, invalid scope and deletes fail at schema boundary', () => {
    const db = openInitializedDatabase(dbPath)
    try {
      const people = db.prepare('SELECT id FROM users ORDER BY role').all()
      const payload = () => {
        const id = randomUUID()
        db.prepare(
          'INSERT INTO encrypted_payloads(id,key_version,iv,ciphertext,auth_tag) VALUES(?,?,?,?,?)',
        ).run(
          id,
          'v1',
          randomBytes(12),
          Buffer.from('FICTIONAL_CIPHERTEXT_BYTES'),
          randomBytes(16),
        )
        return id
      }
      const folder = randomUUID(),
        item = randomUUID()
      db.prepare(
        'INSERT INTO folders(id,owner_id,visibility,encrypted_payload_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      ).run(folder, people[0].id, 'household', payload(), 1, 1)
      const insert = db.prepare(
        'INSERT INTO credentials(id,owner_id,folder_id,visibility,encrypted_payload_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      assert.throws(() =>
        insert.run(randomUUID(), people[1].id, folder, null, payload(), 1, 1),
      )
      assert.throws(() =>
        insert.run(
          randomUUID(),
          people[0].id,
          folder,
          'personal',
          payload(),
          1,
          1,
        ),
      )
      insert.run(item, people[0].id, folder, null, payload(), 1, 1)
      assert.equal(
        db
          .prepare('SELECT visibility FROM credential_visibility WHERE id=?')
          .get(item).visibility,
        'household',
      )
      db.prepare(
        "UPDATE folders SET visibility='personal', version=version+1 WHERE id=?",
      ).run(folder)
      assert.equal(
        db
          .prepare('SELECT visibility FROM credential_visibility WHERE id=?')
          .get(item).visibility,
        'personal',
      )
      assert.throws(() =>
        db.prepare('DELETE FROM folders WHERE id=?').run(folder),
      )
      assert.throws(() =>
        db.prepare('DELETE FROM users WHERE id=?').run(people[0].id),
      )
      const row = db
        .prepare('SELECT version FROM credentials WHERE id=?')
        .get(item)
      assert.equal(
        db
          .prepare(
            'UPDATE credentials SET version=version+1 WHERE id=? AND version=?',
          )
          .run(item, row.version).changes,
        1,
      )
      assert.equal(
        db
          .prepare(
            'UPDATE credentials SET version=version+1 WHERE id=? AND version=?',
          )
          .run(item, row.version).changes,
        0,
      )
    } finally {
      close(db)
    }
  })
  await test('backup is encrypted, restore is isolated and sessions/reset artifacts never revive', async () => {
    const db = openInitializedDatabase(dbPath)
    try {
      const id = db.prepare('SELECT id FROM users LIMIT 1').get().id
      db.prepare(
        'INSERT INTO sessions(id,token_digest,user_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(?,?,?,?,?,?,?)',
      ).run(randomUUID(), randomBytes(32), id, 1, 1, 5, 10)
      db.prepare(
        'INSERT INTO account_tokens(id,token_digest,user_id,purpose,created_at,expires_at) VALUES(?,?,?,?,?,?)',
      ).run(randomUUID(), randomBytes(32), id, 'password-reset', 1, 5)
    } finally {
      close(db)
    }
    const archive = join(root, 'backups', 'test.lbbak')
    await backupDatabase(dbPath, keyFile, archive)
    const contents = readFileSync(archive)
    assert.ok(!contents.includes(Buffer.from('fictional-test-verifier')))
    assert.ok(!contents.includes(Buffer.from('SQLite format 3')))
    const target = join(root, 'restored', 'lockbox.sqlite')
    restoreDatabase(archive, keyFile, target)
    const restored = openInitializedDatabase(target)
    try {
      assert.equal(
        restored.prepare('SELECT count(*) AS n FROM sessions').get().n,
        0,
      )
      assert.equal(
        restored.prepare('SELECT count(*) AS n FROM account_tokens').get().n,
        0,
      )
      assert.equal(
        restored
          .prepare(
            'SELECT count(*) AS n FROM users WHERE password_reset_required=1',
          )
          .get().n,
        2,
      )
      assert.equal(
        restored.prepare('SELECT count(*) AS n FROM credentials').get().n,
        1,
      )
      verifyDatabaseKeys(restored, loadKeyFile(keyFile))
    } finally {
      close(restored)
    }
    await assert.rejects(
      () => backupDatabase(dbPath, keyFile, archive),
      code('BACKUP_ALREADY_EXISTS'),
    )
    assert.throws(
      () => restoreDatabase(archive, keyFile, dbPath),
      code('RESTORE_DIRECTORY_NOT_EMPTY'),
    )
    const corrupted = join(root, 'backups', 'tampered.lbbak')
    const data = JSON.parse(contents)
    data.tag = Buffer.alloc(16).toString('base64')
    writeFileSync(corrupted, JSON.stringify(data), { mode: 0o600 })
    assert.throws(
      () =>
        restoreDatabase(
          corrupted,
          keyFile,
          join(root, 'badrestore', 'db.sqlite'),
        ),
      code('BACKUP_AUTHENTICATION_FAILED'),
    )
    assert.ok(!existsSync(join(root, 'badrestore', 'db.sqlite')))
    assert.throws(
      () =>
        restoreDatabase(
          archive,
          join(root, 'wrongkeys', 'key.json'),
          join(root, 'wrongrestore', 'db.sqlite'),
        ),
      code('BACKUP_AUTHENTICATION_FAILED'),
    )
  })
  await test('configuration validates origin, paths, overlap and log level', () => {
    assert.equal(loadFoundationConfig({}).port, 8787)
    assert.throws(() =>
      loadFoundationConfig({ LOCKBOX_DB_PATH: 'relative.sqlite' }),
    )
    assert.throws(() => loadFoundationConfig({ NODE_ENV: 'production' }))
    assert.throws(() => loadFoundationConfig({ LOCKBOX_LOG_LEVEL: 'secrets' }))
    assert.throws(() =>
      loadFoundationConfig({ LOCKBOX_APP_ORIGIN: 'http://example.com' }),
    )
    assert.throws(
      () =>
        loadFoundationConfig({
          LOCKBOX_DB_PATH: join(root, 'db', 'x.sqlite'),
          LOCKBOX_KEY_FILE: join(root, 'db', 'key.json'),
        }),
      code('CONFIG_STORAGE_OVERLAP'),
    )
  })
  await test('structured logs drop unapproved metadata; real Fastify routes keep auth/vault/Drive inactive', async () => {
    const lines = []
    const log = createLogger('info', (line) => lines.push(line))
    log('info', 'foundation.test', {
      code: 'TEST_OK',
      password: 'DO_NOT_LOG',
      key: 'DO_NOT_LOG',
    })
    const app = createBackendApp(log)
    try {
      const health = await app.inject({ method: 'GET', url: '/healthz' })
      assert.equal(health.statusCode, 200)
      assert.equal(health.json().authentication, 'not-implemented')
      for (const url of [
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/reset',
        '/api/credentials',
        '/api/admin/google-drive/callback?code=DO_NOT_LOG',
      ]) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { authorization: 'DO_NOT_LOG' },
          payload: { password: 'DO_NOT_LOG' },
        })
        assert.equal(response.statusCode, 503)
        assert.deepEqual(response.json(), {
          code: 'INTEGRATION_NOT_IMPLEMENTED',
        })
        assert.equal(response.headers['cache-control'], 'no-store')
      }
      assert.equal(
        (await app.inject({ method: 'GET', url: '/unknown' })).statusCode,
        404,
      )
      assert.ok(!lines.join('').includes('DO_NOT_LOG'))
      assert.equal(JSON.parse(lines[0]).code, 'TEST_OK')
    } finally {
      await app.close()
    }
  })
  await test('CLI database/key verification works and missing-key server startup fails without creating secrets', () => {
    const environment = {
      ...process.env,
      LOCKBOX_DB_PATH: dbPath,
      LOCKBOX_KEY_FILE: keyFile,
      LOCKBOX_BACKUP_DIR: join(root, 'backups'),
      LOCKBOX_LOG_LEVEL: 'info',
    }
    const run = (entry, args = [], env = environment) =>
      spawnSync(
        process.execPath,
        ['--experimental-strip-types', entry, ...args],
        { env, encoding: 'utf8', timeout: 30000, windowsHide: true },
      )
    for (const action of ['db:init', 'db:check', 'key:check']) {
      const result = run('server/cli.ts', [action])
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    const missing = join(root, 'nevercreated', 'key.json')
    const result = run('server/index.ts', [], {
      ...environment,
      LOCKBOX_KEY_FILE: missing,
    })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /KEY_FILE_MISSING/)
    assert.ok(!existsSync(missing))
  })
  await test('invitation CLI writes a private exclusive file and never prints its bearer secret', () => {
    const inviteDbPath = join(root, 'invite-db', 'lockbox.sqlite')
    const inviteKey = join(root, 'invite-keys', 'key.json')
    const output = join(root, 'invitations', 'first.json')
    initializeDatabase(inviteDbPath)
    const inviteDb = openInitializedDatabase(inviteDbPath)
    try {
      initializeKeyFile(inviteDb, inviteKey)
      const run = () =>
        spawnSync(
          process.execPath,
          [
            '--experimental-strip-types',
            'server/cli.ts',
            'auth:invite',
            '--role',
            'administrator',
            '--output',
            output,
          ],
          {
            env: {
              ...process.env,
              LOCKBOX_DB_PATH: inviteDbPath,
              LOCKBOX_KEY_FILE: inviteKey,
              LOCKBOX_BACKUP_DIR: join(root, 'backups'),
            },
            encoding: 'utf8',
            timeout: 30000,
            windowsHide: true,
          },
        )
      const result = run()
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assertPrivate(output, 'file')
      const contents = readFileSync(output, 'utf8'),
        invitation = JSON.parse(contents)
      assert.match(invitation.inviteCode, /^[A-Za-z0-9_-]{43}$/)
      assert.equal(invitation.role, 'administrator')
      assert.ok(
        !(result.stdout + result.stderr).includes(invitation.inviteCode),
      )
      const repeated = run()
      assert.equal(repeated.status, 1)
      assert.equal(readFileSync(output, 'utf8'), contents)
      assert.equal(
        inviteDb.prepare('SELECT count(*) AS n FROM users').get().n,
        0,
      )
    } finally {
      inviteDb.close()
    }
  })
} finally {
  assert.ok(
    resolve(root).startsWith(resolve(testParent) + sep) &&
      root.includes('lockbox-phase1-'),
    'Unsafe test cleanup',
  )
  rmSync(root, { recursive: true, force: true })
}
