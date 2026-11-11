import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { GoogleSession } from '../native/google-session.mjs'
import { NativeDrive } from '../native/drive.mjs'
import { assertCloudMode } from '../native/cloud-policy.mjs'
import {
  GoogleConnection,
  nativeAuthorization,
  validateConfiguration,
  FILE_SCOPE,
  FULL_SCOPE,
} from '../native/oauth.mjs'
import { Replica } from '../native/replica.mjs'
import {
  clone,
  newIdentity,
  signed,
  hash,
  publicIdentity,
} from '../native/identity.mjs'
import {
  createProfile,
  seal,
  toBase64,
  destroyKeys,
} from '../../../src/features/vault/crypto.ts'
import { VaultEngine } from '../../../src/features/vault/engine.ts'
const configuration = {
  clientId: '123456-fictional.apps.googleusercontent.com',
  scope: FILE_SCOPE,
}
const google = {
  permissionId: 'fictional-owner',
  emailAddress: 'owner@example.invalid',
}
const tokens = () => ({
  clientId: configuration.clientId,
  scope: FILE_SCOPE,
  access: 'fictional-access',
  refresh: 'fictional-refresh',
  expires: Date.now() + 3600000,
})
function state(initial = { google: null, tokens: null }) {
  let record = clone(initial),
    writes = 0
  return {
    fail: false,
    read: () => clone(record),
    write(value) {
      if (this.fail) throw new Error('Fictional protected write failure')
      record = clone(value)
      writes++
    },
    count: () => writes,
  }
}
function session(store, overrides = {}) {
  return new GoogleSession(configuration, {
    read: store.read,
    write: (value) => store.write(value),
    authorise: async () => tokens(),
    account: async () => google,
    ...overrides,
  })
}

await test('production vault sync is blocked even with registration; only isolated fictional tests use narrow Drive scope', () => {
  assert.throws(
    () => assertCloudMode({ configuration }),
    /LIVE_VAULT_SYNC_BLOCKED/,
  )
  assert.throws(
    () => assertCloudMode({ googleTest: true, configuration: null }),
    /CLIENT_REQUIRED/,
  )
  assert.throws(
    () =>
      assertCloudMode({
        googleTest: true,
        configuration: { ...configuration, scope: FULL_SCOPE },
      }),
    /SCOPE_NOT_APPROVED/,
  )
  assert.doesNotThrow(() =>
    assertCloudMode({ googleTest: true, configuration }),
  )
  assert.throws(
    () =>
      validateConfiguration({
        clientId:
          'DEVELOPER_REGISTERED_DESKTOP_CLIENT.apps.googleusercontent.com',
      }),
    /CLIENT_REQUIRED/,
  )
})
await test('connection saves a verified account and grant atomically; failure and account switching preserve the old grant', async () => {
  const store = state(),
    connection = session(store)
  await connection.connect()
  assert.equal(connection.connected, true)
  assert.equal(store.count(), 1)
  const previous = store.read()
  store.fail = true
  await assert.rejects(() => connection.connect(), /protected write/)
  store.fail = false
  assert.deepEqual(store.read(), previous)
  assert.equal(connection.connected, true)
  const other = session(store, {
    account: async () => ({ ...google, permissionId: 'fictional-other' }),
  })
  await assert.rejects(() => other.connect(), /ACCOUNT_CHANGED/)
  assert.deepEqual(store.read(), previous)
})
await test('parallel consent and late OAuth results cannot overwrite a disconnect', async () => {
  let release
  const gate = new Promise((resolve) => {
      release = resolve
    }),
    store = state()
  const connection = session(store, {
    authorise: async () => {
      await gate
      return tokens()
    },
  })
  const pending = connection.connect()
  await assert.rejects(() => connection.connect(), /AUTH_IN_PROGRESS/)
  connection.disconnect()
  release()
  await assert.rejects(() => pending, /CONNECTION_CHANGED/)
  assert.equal(store.read().tokens, null)
  assert.equal(connection.connected, false)
})
await test('late refresh cannot resurrect disconnected tokens; expired grants stop reporting connected', async () => {
  let release
  const gate = new Promise((resolve) => {
      release = resolve
    }),
    store = state({ google, tokens: { ...tokens(), expires: 0 } })
  const connection = session(store, {
    refreshFetch: async () => {
      await gate
      return new Response(
        JSON.stringify({
          access_token: 'fictional-new',
          expires_in: 3600,
          scope: FILE_SCOPE,
        }),
      )
    },
  })
  connection.restore()
  const pending = connection.connection.access()
  connection.disconnect()
  release()
  await assert.rejects(() => pending, /CONNECTION_CHANGED/)
  assert.equal(store.read().tokens, null)
  const expired = session(
    state({ google, tokens: { ...tokens(), expires: 0 } }),
    { refreshFetch: async () => new Response('{}', { status: 400 }) },
  )
  expired.restore()
  await assert.rejects(() => expired.connection.access(), /RECONNECT_REQUIRED/)
  assert.equal(expired.connected, false)
})
await test('refresh persistence failure rolls back the in-memory token instead of pretending it was saved', async () => {
  const old = { ...tokens(), expires: 0 },
    connection = new GoogleConnection(
      configuration,
      old,
      () => {
        throw new Error('Fictional write failed')
      },
      async () =>
        new Response(
          JSON.stringify({ access_token: 'fictional-new', expires_in: 3600 }),
        ),
    )
  await assert.rejects(() => connection.access(), /write failed/)
  assert.deepEqual(connection.tokens, old)
})
await test('native cancellation closes its temporary loopback listener without saving authorisation', async () => {
  const controller = new AbortController()
  let callback
  await assert.rejects(
    () =>
      nativeAuthorization(configuration, {
        signal: controller.signal,
        open: async (value) => {
          callback = new URL(value).searchParams.get('redirect_uri')
          controller.abort()
        },
        fetch: async () => {
          throw new Error('Token exchange must not run')
        },
      }),
    /AUTH_CANCELLED/,
  )
  await assert.rejects(() =>
    fetch(callback, { signal: AbortSignal.timeout(1000) }),
  )
})
await test('Picker must return every requested folder before a code is exchanged', async () => {
  let exchanges = 0
  await assert.rejects(
    () =>
      nativeAuthorization(configuration, {
        pickFolders: ['fictional-folder-00000001'],
        open: async (value) => {
          const url = new URL(value),
            cb = new URL(url.searchParams.get('redirect_uri'))
          cb.searchParams.set('state', url.searchParams.get('state'))
          cb.searchParams.set('code', 'fictional-code')
          await fetch(cb)
        },
        fetch: async () => {
          exchanges++
          return new Response('{}')
        },
      }),
    /FOLDER_SELECTION_REQUIRED/,
  )
  assert.equal(exchanges, 0)
})
await test('Drive network boundary rejects plaintext, extra fields and altered signatures before any upload', async () => {
  const identity = newIdentity(),
    prepared = await createProfile(
      identity.accountId,
      'Fictional Google test master 123!',
      'Fictional Google test master 123!',
    )
  let requests = 0
  const drive = new NativeDrive(
    { access: async () => 'fictional-token' },
    {
      fetch: async () => {
        requests++
        return new Response('{}')
      },
      sleep: async () => {},
    },
  )
  try {
    const id = 'personal:' + identity.accountId,
      body = {
        v: 1,
        kind: 'lockbox-proof-commit',
        scope: 'personal',
        vaultId: id,
        author: {
          accountId: identity.accountId,
          deviceId: identity.deviceId,
          signPublic: identity.signPublic,
          boxPublic: identity.boxPublic,
        },
        parents: [],
        nonce: randomUUID(),
        control: null,
        snapshot: {
          profile: { revision: 1, data: prepared.profile },
          vault: {
            id,
            scope: 'personal',
            ownerId: identity.accountId,
            revision: 1,
            payload: seal(
              prepared.keys.personal,
              { v: 1, credentials: [], folders: [] },
              'vault:' + id + ':1',
            ),
            check: null,
          },
        },
      }
    await assert.rejects(() =>
      drive.create('fictional-file-00000001', 'fictional-folder-00000001', {
        password: 'Fictional plaintext',
      }),
    )
    const extra = clone(body)
    extra.snapshot.vault.password = 'Fictional plaintext'
    await assert.rejects(() =>
      drive.create(
        'fictional-file-00000001',
        'fictional-folder-00000001',
        signed(identity, extra),
      ),
    )
    const changed = signed(identity, body)
    changed.body.nonce = randomUUID()
    await assert.rejects(
      () =>
        drive.create(
          'fictional-file-00000001',
          'fictional-folder-00000001',
          changed,
        ),
      /SIGNATURE/,
    )
    assert.equal(requests, 0)
    await drive.create(
      'fictional-file-00000001',
      'fictional-folder-00000001',
      signed(identity, body),
    )
    assert.equal(requests, 1)
  } finally {
    destroyKeys(prepared.keys)
  }
})
await test('API-disabled and rate-limit errors are distinguished from missing file permissions without broader OAuth', async () => {
  let attempts = 0
  const disabled = new NativeDrive(
    { access: async () => 'fictional-token' },
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { errors: [{ reason: 'accessNotConfigured' }] },
          }),
          { status: 403 },
        ),
      sleep: async () => {},
    },
  )
  await assert.rejects(() => disabled.account(), /DRIVE_API_NOT_ENABLED/)
  const limited = new NativeDrive(
    { access: async () => 'fictional-token' },
    {
      fetch: async () => {
        attempts++
        return attempts === 1
          ? new Response(
              JSON.stringify({
                error: { errors: [{ reason: 'rateLimitExceeded' }] },
              }),
              { status: 403 },
            )
          : new Response(JSON.stringify({ user: google }))
      },
      sleep: async () => {},
    },
  )
  assert.deepEqual(await limited.account(), google)
  assert.equal(attempts, 2)
})
await test('test profiles reject normal profiles, backups and invitations before mutating existing data or granting permissions', async () => {
  let normalData = null,
    testData = null
  const normalStore = {
    load: () => normalData && clone(normalData),
    save: (data) => {
      normalData = clone(data)
    },
  }
  const normal = new Replica(normalStore, 'owner', () => {
    throw new Error('No Drive')
  })
  const prepared = await VaultEngine.prepare(
    normal.id,
    'Fictional mode master password 123!',
    'Fictional mode master password 123!',
  )
  const api = async (path, body) =>
    normal.api(
      path,
      body,
      path === 'setup' ? toBase64(prepared.keys.root) : undefined,
    )
  const engine = await VaultEngine.finishSetup(
    api,
    normal.id,
    prepared,
    prepared.recoveryCode,
  )
  const isolated = new Replica(
    {
      load: () => testData && clone(testData),
      save: (data) => {
        testData = clone(data)
      },
    },
    'owner',
    () => {
      throw new Error('No Drive')
    },
    { cloudTest: true },
  )
  try {
    const before = clone(normalData)
    assert.throws(
      () => new Replica(normalStore, 'owner', () => {}, { cloudTest: true }),
      /MODE_MISMATCH/,
    )
    assert.deepEqual(normalData, before)
    const backup = normal.exportBackup(toBase64(prepared.keys.root)),
      empty = clone(testData)
    assert.throws(
      () => isolated.restoreBackup(backup, toBase64(prepared.keys.root)),
      /MODE_MISMATCH/,
    )
    assert.deepEqual(testData, empty)
    const testPrepared = await VaultEngine.prepare(
      isolated.id,
      'Fictional isolated mode master 456!',
      'Fictional isolated mode master 456!',
    )
    const testApi = async (path, body) =>
      isolated.api(
        path,
        body,
        path === 'setup' ? toBase64(testPrepared.keys.root) : undefined,
      )
    const testEngine = await VaultEngine.finishSetup(
      testApi,
      isolated.id,
      testPrepared,
      testPrepared.recoveryCode,
    )
    try {
      await testEngine.createHousehold()
      isolated.data.google = google
      isolated.data.folders = {
        shared: 'fictional-folder-00000001',
        partnerPersonal: 'fictional-folder-00000002',
      }
      normal.account({
        ...google,
        permissionId: 'fictional-peer',
        emailAddress: 'partner@example.invalid',
      })
      await assert.rejects(
        () =>
          isolated.grant(
            normal.pairing(),
            hash(publicIdentity(normal.data.identity)),
            testEngine.exportHousehold(),
          ),
        /MODE_MISMATCH/,
      )
    } finally {
      testEngine.lock()
    }
  } finally {
    engine.lock()
    normal.lockIdentity()
    isolated.lockIdentity()
  }
})
