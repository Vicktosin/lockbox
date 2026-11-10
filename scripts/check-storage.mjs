import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { test } from 'node:test'
import { loadBackendConfig } from '../server/config/environment.ts'
import { vaultNamespace } from '../server/storage/namespaces.ts'
import { DisabledGoogleDriveStore } from '../server/storage/google-drive/disabled-store.ts'
import { createScaffoldServer } from '../server/http/scaffold.ts'

test('backend config has no hardcoded folder or secret fallback; env location remains configurable', () => {
  const empty = loadBackendConfig({})
  assert.equal(empty.driveFolderId, null)
  assert.equal(empty.oauth.clientSecretRef, null)
  assert.equal(empty.port, 8787)
  const configured = loadBackendConfig({
    GOOGLE_DRIVE_FOLDER_ID: 'example_test_folder',
    LOCKBOX_BACKEND_PORT: '8788',
    GOOGLE_OAUTH_CLIENT_SECRET_REF: 'secret-manager/client-secret',
  })
  assert.equal(configured.driveFolderId, 'example_test_folder')
  assert.equal(configured.port, 8788)
  assert.deepEqual(configured.oauth.scopes, [
    'openid',
    'https://www.googleapis.com/auth/drive.file',
  ])
  assert.equal(
    loadBackendConfig({ VITE_GOOGLE_DRIVE_FOLDER_ID: 'must_not_be_used' })
      .driveFolderId,
    null,
  )
  const example = readFileSync(
    new URL('../server/.env.example', import.meta.url),
    'utf8',
  )
  assert.match(
    example,
    /^GOOGLE_DRIVE_FOLDER_ID=1AIiW6Ce2NZyp8Z0CKyWphHHEh3NcUxTb$/m,
  )
  assert.throws(() =>
    loadBackendConfig({
      GOOGLE_DRIVE_FOLDER_ID: 'https://drive.google.com/folder',
    }),
  )
  for (const port of ['0', '-1', '65536', '8787oops', '2.5'])
    assert.throws(() => loadBackendConfig({ LOCKBOX_BACKEND_PORT: port }))
})

test('three logical namespaces cannot collide or include path/query injection', () => {
  const common = { householdId: 'household_1', vaultId: 'vault_1' }
  const administrator = vaultNamespace({
    ...common,
    kind: 'personal',
    ownerId: 'admin_1',
  })
  const wife = vaultNamespace({
    ...common,
    kind: 'personal',
    ownerId: 'member_2',
  })
  const shared = vaultNamespace({ ...common, kind: 'shared' })
  assert.equal(new Set([administrator, wife, shared]).size, 3)
  assert.equal(administrator, 'households/household_1/personal/admin_1/vault_1')
  assert.equal(wife, 'households/household_1/personal/member_2/vault_1')
  assert.equal(shared, 'households/household_1/shared/vault_1')
  for (const id of [
    '',
    '../admin',
    'user/name',
    "query' or true",
    'x'.repeat(129),
  ]) {
    assert.throws(() =>
      vaultNamespace({ ...common, kind: 'personal', ownerId: id }),
    )
    assert.throws(() =>
      vaultNamespace({ ...common, kind: 'shared', householdId: id }),
    )
  }
})

test('Drive adapter fails closed for create/read/trash regardless of payload labels', async () => {
  const store = new DisabledGoogleDriveStore()
  const labelledPlaintext = {
    format: 'lockbox.encrypted-vault',
    formatVersion: 1,
    bytes: new TextEncoder().encode('plaintext is not encryption'),
  }
  for (const operation of [
    () => store.create('namespace', labelledPlaintext, 'mutation'),
    () => store.read('namespace', 'object'),
    () => store.trash('namespace', 'object'),
  ]) {
    await assert.rejects(
      operation,
      (error) => error.code === 'DRIVE_INTEGRATION_NOT_READY',
    )
  }
})

test('HTTP scaffold exposes only health; OAuth and vault routes cannot accept data or spoofed identities', async () => {
  const server = createScaffoldServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const health = await fetch(`${origin}/healthz`)
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('cache-control'), 'no-store')
    assert.equal(health.headers.get('access-control-allow-origin'), null)
    assert.equal(health.headers.get('set-cookie'), null)
    assert.deepEqual(await health.json(), {
      status: 'scaffold',
      storage: 'disabled',
      authentication: 'not-implemented',
    })
    for (const [method, path] of [
      ['POST', '/api/admin/google-drive/connect'],
      [
        'GET',
        '/api/admin/google-drive/callback?code=fake-code&state=fake-state',
      ],
      ['DELETE', '/api/admin/google-drive/connection'],
      ['GET', '/api/v1/vaults'],
      ['GET', '/api/v1/vaults/wife/snapshot'],
      ['PUT', '/api/v1/vaults/wife/snapshot'],
      ['DELETE', '/api/v1/vaults/wife'],
      ['GET', '/api/v1/vault-changes'],
    ]) {
      const response = await fetch(origin + path, {
        method,
        headers: {
          'x-user-id': 'wife',
          'x-role': 'administrator',
          Authorization: 'Bearer fake',
        },
        ...(method === 'PUT'
          ? { body: JSON.stringify({ password: 'mock-plaintext' }) }
          : {}),
      })
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), {
        code: 'INTEGRATION_NOT_IMPLEMENTED',
      })
    }
    const unknown = await fetch(`${origin}/unrecognised`)
    assert.equal(unknown.status, 404)
    await unknown.text()
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
