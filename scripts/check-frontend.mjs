import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
import { test } from 'node:test'
import {
  assertSameOrigin,
  GoogleHttpError,
  verifyGoogleIdentity,
} from '../src/lib/server/google.ts'
import { DriveVaultService } from '../src/lib/server/drive-vault.ts'
import { GET as googleConfig } from '../src/app/api/google/config/route.ts'

const dom = new Window({ url: 'https://lockbox.example/' })
for (const key of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'Event',
  'MouseEvent',
  'MutationObserver',
  'Node',
]) {
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? dom : dom[key],
    configurable: true,
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true } })
const { GoogleAuthGate } = await server.ssrLoadModule(
  '/src/features/web/google-auth-gate.tsx',
)
const container = dom.document.createElement('div')
dom.document.body.append(container)
const originalFetch = globalThis.fetch

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function waitForText(pattern) {
  const deadline = Date.now() + 3000
  while (!pattern.test(container.textContent ?? '')) {
    assert.ok(
      Date.now() < deadline,
      'Timed out waiting for ' +
        pattern +
        '; current UI: ' +
        container.textContent,
    )
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

try {
  await test('Google identity requires a verified bearer token', async () => {
    const calls = []
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return response({
        sub: 'google-subject-123',
        email: 'person@example.test',
        email_verified: true,
      })
    }

    assert.deepEqual(await verifyGoogleIdentity('fictional-token-value'), {
      id: 'google-subject-123',
      email: 'person@example.test',
    })
    assert.equal(
      calls[0].url,
      'https://openidconnect.googleapis.com/v1/userinfo',
    )
    assert.equal(
      calls[0].options.headers.get('authorization'),
      'Bearer fictional-token-value',
    )

    globalThis.fetch = async () =>
      response({
        sub: 'google-subject-123',
        email: 'person@example.test',
        email_verified: false,
      })
    await assert.rejects(
      verifyGoogleIdentity('fictional-token-value'),
      (error) =>
        error instanceof GoogleHttpError &&
        error.status === 401 &&
        error.code === 'GOOGLE_IDENTITY_INVALID',
    )
  })

  await test('API mutations reject cross-origin requests', () => {
    assert.doesNotThrow(() =>
      assertSameOrigin(
        new Request('https://lockbox.example/api/vault/state', {
          method: 'POST',
          headers: { origin: 'https://lockbox.example' },
        }),
        true,
      ),
    )
    assert.throws(
      () =>
        assertSameOrigin(
          new Request('https://lockbox.example/api/vault/state', {
            method: 'POST',
            headers: { origin: 'https://attacker.example' },
          }),
          true,
        ),
      (error) =>
        error instanceof GoogleHttpError &&
        error.status === 403 &&
        error.code === 'REQUEST_FORBIDDEN',
    )
  })

  await test('Household Drive data is exposed only to its owner or invited email', async () => {
    const folderId = 'household-folder-123'
    const envelope = {
      v: 1,
      alg: 'XChaCha20-Poly1305',
      nonce: 'A'.repeat(32),
      ciphertext: 'A'.repeat(24),
    }
    const files = {
      'account-fixture': {
        id: 'account-fixture',
        name: 'lockbox-account-v1.json',
        mimeType: 'application/json',
        parents: ['appDataFolder'],
      },
      'household-fixture': {
        id: 'household-fixture',
        name: 'lockbox-household-v1.json',
        mimeType: 'application/json',
        parents: [folderId],
      },
    }
    const account = { v: 1, profile: null, personal: null, history: [] }
    const household = {
      v: 1,
      id: '123e4567-e89b-42d3-a456-426614174000',
      ownerId: 'owner-subject',
      ownerEmail: 'owner@example.test',
      revision: 1,
      payload: envelope,
      check: envelope,
      members: [
        {
          id: 'drive-permission-id',
          email: 'invited@example.test',
          access: 'invited',
        },
      ],
      history: [],
    }
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      const json = (value, etag) =>
        new Response(JSON.stringify(value), {
          headers: etag
            ? { 'content-type': 'application/json', etag }
            : { 'content-type': 'application/json' },
        })
      if (url.pathname === `/drive/v3/files/${folderId}`)
        return json({
          id: folderId,
          mimeType: 'application/vnd.google-apps.folder',
          capabilities: { canAddChildren: true },
        })
      if (url.pathname === '/drive/v3/files' && url.searchParams.has('q')) {
        return json({
          files: url.searchParams.get('q').includes('lockbox-account-v1.json')
            ? [files['account-fixture']]
            : [files['household-fixture']],
        })
      }
      if (url.pathname === '/drive/v3/files/account-fixture')
        return url.searchParams.get('alt') === 'media'
          ? json(account)
          : json(files['account-fixture'], '"account-revision-1"')
      if (url.pathname === '/drive/v3/files/household-fixture')
        return url.searchParams.get('alt') === 'media'
          ? json(household)
          : json(files['household-fixture'], '"household-revision-1"')
      throw new Error('Unexpected mocked Drive request: ' + url)
    }

    async function readState(identity) {
      const service = new DriveVaultService(
        'fictional-token-value',
        identity,
        folderId,
      )
      await service.validateFolder()
      const state = await service.handle(
        'state',
        'GET',
        undefined,
        new URLSearchParams(),
      )
      return state.json()
    }

    const outsider = await readState({
      id: 'outsider-subject',
      email: 'outsider@example.test',
    })
    assert.equal(outsider.household, null)
    assert.deepEqual(outsider.candidates, [])

    const owner = await readState({
      id: 'owner-subject',
      email: 'owner@example.test',
    })
    assert.equal(owner.household?.joined, true)
    assert.equal(owner.candidates[0].username, 'invited@example.test')

    const invited = await readState({
      id: 'invited-subject',
      email: 'invited@example.test',
    })
    assert.equal(invited.household?.joined, false)
    assert.deepEqual(invited.candidates, [])
  })

  await test('missing Google deployment settings keep sign-in unavailable', async () => {
    const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_API_KEY', 'GOOGLE_APP_ID']
    const previous = names.map((name) => process.env[name])
    for (const name of names) delete process.env[name]
    try {
      const result = googleConfig()
      assert.equal(result.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await result.json(), {
        configured: false,
        clientId: null,
        apiKey: null,
        appId: null,
      })
    } finally {
      names.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name]
        else process.env[name] = previous[index]
      })
    }

    globalThis.fetch = async () =>
      response({
        configured: false,
        clientId: null,
        apiKey: null,
        appId: null,
      })
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(GoogleAuthGate)))
      await waitForText(/maintainer must add the public Google OAuth/)
      const button = [...container.querySelectorAll('button')].find((item) =>
        item.textContent.includes('Sign in with Google'),
      )
      assert.ok(button?.disabled)
      assert.equal(dom.localStorage.length, 0)
      assert.equal(dom.sessionStorage.length, 0)
    } finally {
      await act(async () => root.unmount())
    }
  })

  await test('Google sign-in redirects with declared scopes and keeps no token', async () => {
    const requestedScopes = [
      'openid',
      'email',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata',
    ]
    const clientId = '123456789-test.apps.googleusercontent.com'
    let assigned = ''
    const originalAssign = dom.location.assign
    Object.defineProperty(dom.location, 'assign', {
      configurable: true,
      writable: true,
      value: (url) => {
        assigned = String(url)
      },
    })
    globalThis.fetch = async (url, options) => {
      if (String(url) === '/api/google/config')
        return response({
          configured: true,
          clientId,
          apiKey: 'AIza' + 'a'.repeat(30),
          appId: '123456789',
        })
      assert.equal(
        String(url),
        'https://openidconnect.googleapis.com/v1/userinfo',
      )
      assert.equal(
        options.headers.Authorization,
        'Bearer fictional-access-token-123456',
      )
      return response({
        sub: 'google-subject-123',
        email: 'person@example.test',
        email_verified: true,
      })
    }
    let root = createRoot(container)
    try {
      await act(async () => root.render(createElement(GoogleAuthGate)))
      await waitForText(/Continue with Google/)
      const button = [...container.querySelectorAll('button')].find((item) =>
        item.textContent.includes('Sign in with Google'),
      )
      assert.ok(button && !button.disabled)
      await act(async () => button.click())
      const auth = new URL(assigned)
      assert.equal(
        auth.origin + auth.pathname,
        'https://accounts.google.com/o/oauth2/v2/auth',
      )
      assert.equal(auth.searchParams.get('client_id'), clientId)
      assert.equal(
        auth.searchParams.get('redirect_uri'),
        'https://lockbox.example/',
      )
      assert.equal(auth.searchParams.get('response_type'), 'token')
      assert.equal(auth.searchParams.get('scope'), requestedScopes.join(' '))
      assert.equal(auth.searchParams.get('prompt'), 'select_account consent')
      const state = auth.searchParams.get('state')
      assert.match(state, /^[0-9a-f]{64}$/)
      assert.equal(dom.localStorage.length, 0)
      await act(async () => root.unmount())

      // Google redirects back with the token in the URL fragment.
      dom.history.replaceState(
        null,
        '',
        '/#' +
          new URLSearchParams({
            access_token: 'fictional-access-token-123456',
            token_type: 'Bearer',
            expires_in: '3600',
            scope: [
              'openid',
              'https://www.googleapis.com/auth/userinfo.email',
              'https://www.googleapis.com/auth/userinfo.profile',
              'https://www.googleapis.com/auth/drive.file',
              'https://www.googleapis.com/auth/drive.appdata',
            ].join(' '),
            state,
          }).toString(),
      )
      root = createRoot(container)
      await act(async () => root.render(createElement(GoogleAuthGate)))
      await waitForText(/Choose your storage/)
      assert.match(container.textContent, /person@example\.test/)
      assert.equal(dom.location.hash, '')
      assert.equal(dom.localStorage.length, 0)
      assert.equal(dom.sessionStorage.length, 0)
    } finally {
      await act(async () => root.unmount())
      Object.defineProperty(dom.location, 'assign', {
        configurable: true,
        writable: true,
        value: originalAssign,
      })
    }
  })

  await test('Google sign-in rejects a redirect response with a foreign state', async () => {
    dom.sessionStorage.setItem('lockbox.google.oauth', 'a'.repeat(64))
    dom.history.replaceState(
      null,
      '',
      '/#access_token=stolen-token&expires_in=3600&state=' + 'b'.repeat(64),
    )
    globalThis.fetch = async (url) => {
      assert.equal(String(url), '/api/google/config')
      return response({
        configured: true,
        clientId: '123456789-test.apps.googleusercontent.com',
        apiKey: 'AIza' + 'a'.repeat(30),
        appId: '123456789',
      })
    }
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(GoogleAuthGate)))
      await waitForText(/did not match this browser session/)
      assert.equal(dom.location.hash, '')
      assert.equal(dom.sessionStorage.length, 0)
    } finally {
      await act(async () => root.unmount())
    }
  })
} finally {
  globalThis.fetch = originalFetch
  await server.close()
  await dom.happyDOM.close()
}
