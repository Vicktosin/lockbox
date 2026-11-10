import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  randomBytes,
  randomUUID,
  createSecretKey,
  createHash,
} from 'node:crypto'
import { GoogleFixture } from './google-drive-fixture.mjs'
import { GoogleDriveAdapter } from '../server/drive/provider.ts'
import { sealBackup, unsealBackup } from '../server/maintenance/archive.ts'
import { createRecoveryAssistant } from '../server/maintenance/recovery-assistant.ts'
import { join } from 'node:path'
import { initializeEmergencyKey } from '../server/maintenance/complete.ts'
const google = new GoogleFixture(),
  folder = '1PrivateBackupFolderForTests',
  keys = {
    activeVersion: 'v1',
    keys: new Map([['v1', createSecretKey(randomBytes(32))]]),
  }
const source = randomBytes(2500000),
  encrypted = sealBackup(source, keys).toString('utf8'),
  hash = createHash('sha256').update(encrypted).digest('hex'),
  appId = randomUUID()
const adapter = (
  transport = google.fetch,
  token = async () => 'fictional-google-access-token',
) =>
  new GoogleDriveAdapter({
    folderId: folder,
    resourceKey: null,
    appId,
    fetch: transport,
    token,
    sleep: async () => {},
  })
await test('resumable backup uploads authenticate a multi-chunk encrypted file and download the identical ciphertext', async () => {
  const store = adapter(),
    id = await store.allocate()
  await store.create(id, 'backup', hash, encrypted)
  const result = await store.read(id, 'backup')
  assert.equal(result.sealed, encrypted)
  assert.deepEqual(unsealBackup(Buffer.from(result.sealed), keys), source)
  assert.ok(google.requests.filter((x) => x.method === 'PUT').length >= 3)
})
await test('resumable upload refuses attacker-controlled capability URLs before sending any bearer token', async () => {
  const destinations = []
  const store = adapter(async (url, init) => {
    destinations.push(String(url))
    if (String(url).includes('uploadType=resumable'))
      return new Response('{}', {
        headers: {
          location:
            'https://attacker.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=stolen',
        },
      })
    return google.fetch(url, init)
  })
  await assert.rejects(
    store.create(await store.allocate(), 'backup', hash, encrypted),
    (e) => e.code === 'DRIVE_RESPONSE_INVALID',
  )
  assert.ok(
    destinations.every(
      (x) => new URL(x).origin === 'https://www.googleapis.com',
    ),
  )
})
await test('invalid resumable progress is rejected rather than skipping bytes or looping indefinitely', async () => {
  const store = adapter(async (url, init) =>
    init?.method === 'PUT'
      ? new Response('{}', {
          status: 308,
          headers: { range: 'bytes=0-999999999' },
        })
      : google.fetch(url, init),
  )
  await assert.rejects(
    store.create(await store.allocate(), 'backup', hash, encrypted),
    (e) => e.code === 'DRIVE_RESPONSE_INVALID',
  )
})
await test('backup uploads refresh on unauthorized responses and downloads enforce the larger but bounded backup limit', async () => {
  let rejected = false,
    forced = false
  const store = adapter(
    async (url, init) => {
      if (
        init?.method === 'POST' &&
        String(url).includes('uploadType=resumable') &&
        !rejected
      ) {
        rejected = true
        return new Response('{}', { status: 401 })
      }
      return google.fetch(url, init)
    },
    async (force) => {
      forced ||= force
      return 'fictional-google-access-token'
    },
  )
  const id = await store.allocate()
  await store.create(id, 'backup', hash, encrypted)
  assert.equal(forced, true)
  const oversized = adapter(async (url, init) =>
    String(url).includes('alt=media')
      ? new Response('{}', { headers: { 'Content-Length': '90000001' } })
      : google.fetch(url, init),
  )
  await assert.rejects(
    oversized.read(id, 'backup'),
    (e) => e.code === 'DRIVE_RESPONSE_TOO_LARGE',
  )
})
await test('private recovery assistant rejects host spoofing, cross-origin bootstrap, capability replay and missing recovery proof', async () => {
  const origin = 'http://127.0.0.1:18888',
    assistant = createRecoveryAssistant({
      origin,
      target: join(process.cwd(), 'server', '.data', 'unused-target'),
      workspace: join(process.cwd(), 'server', '.data', 'unused-workspace'),
      application: {
        clientId: 'fictional-client',
        clientSecret: 'fictional-secret',
        redirectUri: origin + '/callback',
      },
      fetch: google.fetch,
    })
  try {
    assert.equal(
      (
        await assistant.app.inject({
          url: '/',
          headers: { host: 'attacker.invalid' },
        })
      ).statusCode,
      403,
    )
    const page = await assistant.app.inject({
      url: '/',
      headers: { host: '127.0.0.1:18888' },
    })
    assert.equal(page.statusCode, 200)
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.ok(!page.body.includes(new URL(assistant.launchUrl).hash.slice(1)))
    const payload = { launch: new URL(assistant.launchUrl).hash.slice(1) }
    assert.equal(
      (
        await assistant.app.inject({
          method: 'POST',
          url: '/api/bootstrap',
          headers: {
            host: '127.0.0.1:18888',
            origin: 'https://attacker.invalid',
          },
          payload,
        })
      ).statusCode,
      403,
    )
    const good = await assistant.app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      headers: { host: '127.0.0.1:18888', origin },
      payload,
    })
    assert.equal(good.statusCode, 200)
    assert.equal(
      (
        await assistant.app.inject({
          method: 'POST',
          url: '/api/bootstrap',
          headers: { host: '127.0.0.1:18888', origin },
          payload,
        })
      ).statusCode,
      403,
    )
    assert.equal(
      (
        await assistant.app.inject({
          method: 'POST',
          url: '/api/restore',
          headers: {
            host: '127.0.0.1:18888',
            origin,
            cookie: String(good.headers['set-cookie']).split(';')[0],
            'x-recovery-csrf': good.json().csrf,
          },
          payload: { fileId: 'fictional-file' },
        })
      ).statusCode,
      400,
    )
  } finally {
    await assistant.app.close()
  }
})
source.fill(0)
await test('emergency key creation rejects backup-folder overlap and never replaces a missing key when cloud backups exist', () => {
  const root = join(
    process.cwd(),
    'server',
    '.data',
    'never-written-' + randomUUID(),
  )
  const config = {
    dbPath: join(root, 'db', 'app.sqlite'),
    keyFile: join(root, 'keys', 'app.json'),
    backupDirectory: join(root, 'recovery'),
    origin: 'http://localhost:5173',
  }
  assert.throws(
    () => initializeEmergencyKey(config),
    (e) => e.code === 'RECOVERY_KEY_OVERLAP',
  )
  assert.throws(
    () =>
      initializeEmergencyKey(
        { ...config, backupDirectory: join(root, 'backups') },
        true,
      ),
    (e) => e.code === 'RECOVERY_KEY_MISSING',
  )
})
