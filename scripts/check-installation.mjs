import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { loadFoundationConfig } from '../server/config/foundation.ts'
import { provisionInstallation } from '../server/maintenance/provision.ts'
import {
  assertPrivate,
  ensurePrivateDirectory,
} from '../server/security/private-files.ts'
import { openInitializedDatabase } from '../server/database/migrations.ts'
import { createBackendApp } from '../server/http/app.ts'
import { packageRelease } from './package-release.mjs'
const parent = realpathSync.native(tmpdir()),
  root = join(parent, 'lockbox-install-' + randomUUID()),
  handoff = join(root, 'keys', 'handoff')
ensurePrivateDirectory(root)
const environment = {
    NODE_ENV: 'production',
    LOCKBOX_APP_ORIGIN: 'https://lockbox.example.invalid',
    LOCKBOX_DB_PATH: join(root, 'db', 'lockbox.sqlite'),
    LOCKBOX_KEY_FILE: join(root, 'keys', 'key.json'),
    LOCKBOX_BACKUP_DIR: join(root, 'backups'),
  },
  config = loadFoundationConfig(environment)
try {
  await test('offline production provisioning creates protected database, keys and one private invitation; repeated initialization preserves them', () => {
    assert.equal(provisionInstallation(config, handoff).database, 'created')
    const file = join(handoff, 'owner-invitation.json'),
      before = readFileSync(file, 'utf8'),
      key = readFileSync(config.keyFile, 'utf8')
    assertPrivate(file, 'file')
    assertPrivate(config.keyFile, 'file')
    assert.equal(
      JSON.parse(before).url.startsWith(config.origin + '/#/join/'),
      true,
    )
    assert.equal(
      provisionInstallation(config, handoff).database,
      'existing-verified',
    )
    assert.equal(readFileSync(file, 'utf8'), before)
    assert.equal(readFileSync(config.keyFile, 'utf8'), key)
  })
  await test('owner registers using prepared link; subsequent provisioning preserves accounts and vault database', async () => {
    const db = openInitializedDatabase(config.dbPath),
      app = createBackendApp(undefined, () => {}, {
        db,
        origin: config.origin,
        production: true,
        vaults: true,
      })
    try {
      const invite = JSON.parse(
          readFileSync(join(handoff, 'owner-invitation.json'), 'utf8'),
        ),
        password = 'Fictional installer validation passphrase!'
      const result = await app.inject({
        url: '/api/auth/register',
        method: 'POST',
        headers: { origin: config.origin },
        payload: {
          username: 'InstallationOwner',
          password,
          passwordConfirmation: password,
          inviteCode: invite.url.split('/').at(-1),
        },
      })
      assert.equal(result.statusCode, 201, result.body)
    } finally {
      await app.close()
      db.close()
    }
    assert.equal(provisionInstallation(config, handoff).accountsPreserved, 1)
    assert.equal(
      provisionInstallation(config, handoff).ownerInvitation,
      'not-needed',
    )
  })
  await test('existing database with a missing key fails closed; insecure HTTPS configuration is rejected', () => {
    assert.throws(() =>
      loadFoundationConfig({
        ...environment,
        LOCKBOX_APP_ORIGIN: 'http://localhost:5173',
      }),
    )
    rmSync(config.keyFile)
    assert.throws(() => provisionInstallation(config, handoff))
    assert.equal(existsSync(config.keyFile), false)
  })
  await test('release package excludes private data, environment and candidate extension; hashes cover runtime files', () => {
    const output = packageRelease(process.cwd(), join(root, 'release')),
      hashes = JSON.parse(readFileSync(join(output, 'SHA256SUMS.json'), 'utf8'))
    assert.ok(hashes['server/index.ts'])
    assert.ok(hashes['dist/index.html'])
    assert.ok(hashes['deploy/install-linux.sh'])
    for (const file of Object.keys(hashes))
      assert.equal(
        /(^|\/)(\.data|\.env|node_modules|extension)(\/|$)/.test(file),
        false,
        file,
      )
    assert.throws(
      () => packageRelease(process.cwd(), output),
      /RELEASE_DESTINATION_EXISTS/,
    )
  })
} finally {
  if (resolve(root).startsWith(resolve(parent) + sep))
    rmSync(root, { recursive: true, force: true })
}
