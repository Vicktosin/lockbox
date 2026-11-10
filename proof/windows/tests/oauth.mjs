import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import {
  nativeAuthorization,
  validateConfiguration,
  GoogleConnection,
  FILE_SCOPE,
  FULL_SCOPE,
} from '../native/oauth.mjs'
const configuration = {
    clientId: '123456-fictional.apps.googleusercontent.com',
  },
  tokens = {
    access_token: 'fictional-access',
    refresh_token: 'fictional-refresh',
    expires_in: 3600,
    scope: FILE_SCOPE,
  }
await test('native OAuth uses a random loopback callback, PKCE, state, offline access, no client secret and verified narrow scope', async () => {
  let request
  const result = await nativeAuthorization(configuration, {
    open: async (value) => {
      const url = new URL(value)
      assert.equal(url.origin, 'https://accounts.google.com')
      assert.equal(url.searchParams.get('scope'), FILE_SCOPE)
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      assert.equal(url.searchParams.get('access_type'), 'offline')
      assert.equal(url.searchParams.has('client_secret'), false)
      request = url
      const invalid = new URL(url.searchParams.get('redirect_uri'))
      invalid.searchParams.set('state', 'invalid')
      assert.equal((await fetch(invalid)).status, 400)
      const callback = new URL(url.searchParams.get('redirect_uri'))
      assert.equal(callback.hostname, '127.0.0.1')
      assert.notEqual(callback.port, '8787')
      callback.searchParams.set('state', url.searchParams.get('state'))
      callback.searchParams.set('code', 'fictional-code')
      const response = await fetch(callback)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal((await response.text()).includes('fictional-code'), false)
    },
    fetch: async (_url, options) => {
      const body = options.body
      assert.equal(body.has('client_secret'), false)
      assert.equal(
        createHash('sha256')
          .update(body.get('code_verifier'))
          .digest('base64url'),
        request.searchParams.get('code_challenge'),
      )
      return new Response(JSON.stringify(tokens))
    },
  })
  assert.equal(result.refresh, 'fictional-refresh')
})
await test('folder picker uses the supported native OAuth trigger; restricted Drive scope requires an explicit developer opt-in', async () => {
  assert.throws(() =>
    validateConfiguration({ ...configuration, scope: FULL_SCOPE }),
  )
  assert.throws(() =>
    validateConfiguration({
      ...configuration,
      client_secret: 'must-not-embed',
    }),
  )
  assert.equal(
    validateConfiguration({
      ...configuration,
      scope: FULL_SCOPE,
      allowRestrictedDriveScope: true,
    }).scope,
    FULL_SCOPE,
  )
  const explicitlyApproved = validateConfiguration({
    ...configuration,
    scope: FULL_SCOPE,
    allowRestrictedDriveScope: true,
  })
  assert.deepEqual(
    validateConfiguration(explicitlyApproved),
    explicitlyApproved,
  )
  await nativeAuthorization(configuration, {
    pickFolders: ['fictional-folder-00000001'],
    open: async (value) => {
      const url = new URL(value)
      assert.equal(url.searchParams.get('trigger_onepick'), 'true')
      assert.equal(url.searchParams.get('allow_folder_selection'), 'true')
      const callback = new URL(url.searchParams.get('redirect_uri'))
      callback.searchParams.set('state', url.searchParams.get('state'))
      callback.searchParams.set('code', 'fictional-code')
      await fetch(callback)
    },
    fetch: async () => new Response(JSON.stringify(tokens)),
  })
})
await test('token refresh is single-flight and never requires a confidential secret', async () => {
  let calls = 0,
    saved
  const connection = new GoogleConnection(
    configuration,
    { access: 'old', refresh: 'fictional-refresh', expires: 0 },
    (value) => {
      saved = value
    },
    async (_url, options) => {
      calls++
      assert.equal(options.body.has('client_secret'), false)
      await new Promise((r) => setTimeout(r, 10))
      return new Response(JSON.stringify(tokens))
    },
  )
  assert.deepEqual(
    await Promise.all([connection.access(), connection.access()]),
    ['fictional-access', 'fictional-access'],
  )
  assert.equal(calls, 1)
  assert.equal(saved.refresh, 'fictional-refresh')
})
