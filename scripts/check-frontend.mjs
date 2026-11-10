import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
import { test } from 'node:test'

// Component tests in a simulated DOM. No browser automation, network or real clipboard.
const dom = new Window({ url: 'http://localhost:5173/#/dashboard' })
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLDialogElement',
  'Event',
  'MouseEvent',
  'HashChangeEvent',
  'MutationObserver',
  'Node',
]) {
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? dom : dom[key],
    configurable: true,
  })
}
const { document } = dom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let clipboard = ''
Object.defineProperty(dom.navigator, 'clipboard', {
  value: {
    writeText: async (value) => {
      clipboard = value
    },
  },
  configurable: true,
})
const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
})
const { DemoWorkspace: App, default: AuthenticatedApp } =
  await server.ssrLoadModule('/src/app/App.tsx')
const { generatePassword, defaultOptions } = await server.ssrLoadModule(
  '/src/features/generator/generate-password.ts',
)
const { securitySummary } = await server.ssrLoadModule(
  '/src/features/credentials/helpers.ts',
)
const { mockCredentials } = await server.ssrLoadModule(
  '/src/features/credentials/mock-data.ts',
)
const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)
const query = (selector) => {
  const result = container.querySelector(selector)
  assert.ok(result, `Missing element: ${selector}`)
  return result
}
const text = () => container.textContent
async function click(selector) {
  await act(async () => {
    query(selector).click()
  })
}
async function button(label) {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent.trim() === label,
  )
  assert.ok(element, `Missing button: ${label}`)
  await act(async () => element.click())
}
async function change(selector, value) {
  const element = query(selector)
  const prototype =
    element.tagName === 'SELECT'
      ? dom.HTMLSelectElement.prototype
      : element.tagName === 'TEXTAREA'
        ? dom.HTMLTextAreaElement.prototype
        : dom.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(
      new dom.Event(element.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    )
  })
}
async function go(page) {
  await act(async () => {
    dom.location.hash = `/${page}`
    dom.dispatchEvent(new dom.HashChangeEvent('hashchange'))
  })
}
async function submit(selector = 'form') {
  await act(async () => {
    query(selector)
      .closest('form')
      .dispatchEvent(
        new dom.Event('submit', { bubbles: true, cancelable: true }),
      )
  })
}
function rows() {
  return [...container.querySelectorAll('tbody tr')]
}

try {
  await test('generator respects length and enabled groups, including boundary cases', () => {
    for (const length of [8, 16, 64]) {
      for (let i = 0; i < 40; i++) {
        const password = generatePassword({ ...defaultOptions, length })
        assert.equal(password.length, length)
        for (const pattern of [/[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/])
          assert.match(password, pattern)
      }
    }
    assert.match(
      generatePassword({
        length: 32,
        uppercase: false,
        lowercase: false,
        numbers: true,
        symbols: false,
      }),
      /^\d{32}$/,
    )
    assert.throws(() =>
      generatePassword({
        length: 20,
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
      }),
    )
    for (const length of [7, 65, 9.5])
      assert.throws(() => generatePassword({ ...defaultOptions, length }))
  })
  await test('security overview derives counts from the sample data', () => {
    const accessible = mockCredentials.filter(
      (item) => item.vault === 'shared' || item.owner === 'emmanuel',
    )
    assert.deepEqual(securitySummary(accessible), {
      weak: 1,
      reused: 2,
      healthy: 6,
      score: 67,
    })
    assert.equal(securitySummary([]).score, 100)
  })
  await act(async () => root.render(createElement(App)))
  await test('dashboard and library render; search, category, grid and empty states work', async () => {
    assert.match(text(), /Welcome back, Emmanuel/)
    await go('library')
    assert.equal(rows().length, 9)
    assert.ok(!text().includes('Pinterest'))
    await change('[aria-label="Search credentials"]', 'netflix')
    assert.equal(rows().length, 1)
    assert.match(rows()[0].textContent, /Netflix/)
    await change('[aria-label="Search credentials"]', 'no-matching-account')
    assert.match(text(), /No matching credentials/)
    await button('Clear filters')
    await change('[aria-label="Filter by category"]', 'Work')
    assert.equal(rows().length, 3)
    await click('[aria-label="Grid view"]')
    assert.equal(container.querySelectorAll('.credential-card').length, 3)
    await go('personal')
    assert.equal(rows().length, 5)
    assert.ok(rows().every((row) => row.textContent.includes('Personal')))
  })
  await test('add, reveal, copy, edit and delete a sample shared credential', async () => {
    await go('shared')
    await button('Add credential')
    assert.equal(query('#credential-vault').value, 'shared')
    await change('#credential-name', 'Household test')
    await change('#credential-url', 'https://example.com')
    await change('#credential-username', 'demo@example.com')
    await change('#credential-password', 'Fictional!Test2026')
    await change('#credential-notes', 'Only a test note')
    await submit()
    assert.match(query('dialog').textContent, /Household test/)
    assert.equal(query('[aria-label="Credential password"]').type, 'password')
    await click('[aria-label="Show password"]')
    assert.equal(query('[aria-label="Credential password"]').type, 'text')
    await click('[aria-label="Copy username"]')
    assert.equal(clipboard, 'demo@example.com')
    await click('[aria-label="Copy password"]')
    assert.equal(clipboard, 'Fictional!Test2026')
    await button('Edit credential')
    await change('#credential-name', 'Updated household test')
    await change('#credential-url', 'javascript:alert(1)')
    await submit()
    assert.match(query('[role="alert"]').textContent, /HTTP or HTTPS/)
    await change('#credential-url', 'https://example.com/updated')
    await submit()
    assert.match(query('dialog').textContent, /Updated household test/)
    await button('Delete')
    await button('Keep credential')
    assert.match(query('dialog').textContent, /Credential details/)
    await button('Delete')
    await button('Delete credential')
    assert.ok(!container.querySelector('dialog'))
    assert.equal(rows().length, 4)
    assert.ok(!rows().some((row) => row.textContent.includes('household test')))
  })
  await test('profile switching isolates private fixtures; shared vault stays consistent', async () => {
    await go('settings')
    await change('#demo-user', 'partner')
    await go('personal')
    assert.equal(rows().length, 2)
    assert.ok(text().includes('Pinterest'))
    assert.ok(!rows().some((row) => row.textContent.includes('GitHub')))
    await go('shared')
    assert.equal(rows().length, 4)
    await go('settings')
    await button('DarkEasy on the evening')
    assert.ok(document.documentElement.classList.contains('dark'))
    await button('LightA little breathing room')
    assert.ok(!document.documentElement.classList.contains('dark'))
  })
  await test('generator options, copy and use-in-credential flow work', async () => {
    await go('generator')
    await change('#password-length', '32')
    await button('Generate password')
    const generated = query('[aria-label="Generated password"]').value
    assert.equal(generated.length, 32)
    await click('[aria-label="Copy password"]')
    assert.equal(clipboard, generated)
    await button('Use in a new credential')
    assert.equal(query('#credential-password').value, generated)
    await button('Cancel')
    for (const element of container.querySelectorAll('.option-row input'))
      await act(async () => element.click())
    assert.match(query('[role="alert"]').textContent, /at least one/)
    assert.ok(
      [...container.querySelectorAll('button')].find(
        (item) => item.textContent === 'Generate password',
      ).disabled,
    )
  })
  await test('mobile navigation opens, makes content inert and closes with Escape', async () => {
    await click('[aria-label="Open navigation"]')
    assert.equal(
      query('[aria-label="Open navigation"]').getAttribute('aria-expanded'),
      'true',
    )
    assert.ok(query('.workspace-main').hasAttribute('inert'))
    assert.equal(query('aside').getAttribute('aria-modal'), 'true')
    await act(async () =>
      document.dispatchEvent(
        new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    )
    assert.equal(
      query('[aria-label="Open navigation"]').getAttribute('aria-expanded'),
      'false',
    )
    assert.ok(!query('.workspace-main').hasAttribute('inert'))
  })
  await test('reset restores deleted records, refresh resets session, unknown route falls back', async () => {
    await go('library')
    await click('[aria-label="View Netflix"]')
    await button('Delete')
    await button('Delete credential')
    await go('shared')
    assert.equal(rows().length, 3)
    await go('settings')
    await button('Reset demo data')
    await button('Cancel')
    await go('shared')
    assert.equal(rows().length, 3)
    await go('settings')
    await button('Reset demo data')
    const dialog = query('dialog')
    await act(async () =>
      [...dialog.querySelectorAll('button')]
        .find((item) => item.textContent === 'Reset demo data')
        .click(),
    )
    await go('shared')
    assert.equal(rows().length, 4)
    await go('unknown')
    assert.match(text(), /Welcome back, Partner/)
    await act(async () => root.unmount())
    const fresh = createRoot(container)
    await act(async () => fresh.render(createElement(App)))
    assert.match(text(), /Welcome back, Emmanuel/)
    await act(async () => fresh.unmount())
  })
  // Exercise the actual application entry point as well as the preserved demo workspace.
  let authenticated = false
  let vaultState = {
    profile: null,
    personal: null,
    household: null,
    candidates: [],
  }
  const master = 'A fictional UI master passphrase!'
  let driveState = {
    configured: false,
    connected: false,
    state: 'disconnected',
    administrator: true,
    account: null,
    folder: null,
    lastSync: null,
    error: null,
    retryAt: null,
    syncing: false,
    conflict: null,
    namespaces: [],
  }
  const changedMaster = 'A changed fictional UI master passphrase!'
  let uiRecovery = ''
  const requests = []
  const account = {
    user: {
      id: 'fictional-user-id',
      username: 'Primary',
      role: 'administrator',
    },
    csrfToken: 'c'.repeat(43),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    const body = options.body ? JSON.parse(options.body) : null
    const response = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    assert.ok(
      String(url).startsWith('/api/auth/') ||
        String(url).startsWith('/api/vault/') ||
        String(url).startsWith('/api/maintenance/') ||
        String(url).startsWith('/api/drive/'),
    )
    assert.equal(options.credentials, 'same-origin')
    if (String(url).startsWith('/api/maintenance/'))
      return response({
        running: false,
        lastError: null,
        policy: { backup_days: 30, history_days: 90 },
        backups: [],
        restore: null,
      })
    if (String(url).startsWith('/api/drive/')) {
      if (!authenticated)
        return response({ code: 'AUTHENTICATION_REQUIRED' }, 401)
      if (body) assert.equal(options.headers['X-CSRF-Token'], account.csrfToken)
      if (url.endsWith('/connect'))
        return response({
          authorizationUrl:
            'https://accounts.google.com/o/oauth2/v2/auth?client_id=fictional-client&state=fictional-state',
        })
      if (url.endsWith('/sync'))
        driveState = { ...driveState, lastSync: Date.now() }
      if (url.endsWith('/disconnect'))
        driveState = { ...driveState, connected: false, state: 'disconnected' }
      return response(driveState)
    }
    if (String(url).startsWith('/api/vault/')) {
      if (!authenticated)
        return response({ code: 'AUTHENTICATION_REQUIRED' }, 401)
      const name = String(url).slice('/api/vault/'.length)
      if (body) assert.equal(options.headers['X-CSRF-Token'], account.csrfToken)
      if (name === 'setup')
        vaultState = {
          ...vaultState,
          profile: { revision: 1, data: body.profile },
          personal: {
            id: 'personal:' + account.user.id,
            scope: 'personal',
            ownerId: account.user.id,
            revision: 1,
            payload: body.payload,
            check: null,
          },
        }
      else if (name === 'personal')
        vaultState = {
          ...vaultState,
          personal: {
            ...vaultState.personal,
            revision: vaultState.personal.revision + 1,
            payload: body.payload,
          },
        }
      else if (name === 'profile')
        vaultState = {
          ...vaultState,
          profile: {
            revision: vaultState.profile.revision + 1,
            data: body.profile,
          },
        }
      else assert.equal(name, 'state')
      return response(vaultState)
    }
    if (url.endsWith('/me'))
      return authenticated
        ? response(account)
        : response({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    if (url.endsWith('/register')) return response({ user: account.user }, 201)
    if (url.endsWith('/invitations')) {
      assert.equal(options.headers['X-CSRF-Token'], account.csrfToken)
      return response({
        inviteCode: 'i'.repeat(43),
        expiresAt: Date.now() + 86400000,
      })
    }
    if (url.endsWith('/recover')) return new Response(null, { status: 204 })
    if (url.endsWith('/recovery-code'))
      return response({ code: 'r'.repeat(43) })
    if (url.endsWith('/login')) {
      if (body.password !== 'Fictional correct passphrase!')
        return response({ code: 'INVALID_CREDENTIALS' }, 401)
      authenticated = true
      return response(account)
    }
    if (url.endsWith('/sessions'))
      return response({
        sessions: [
          {
            id: 'fictional-session',
            device: 'Chrome on Windows',
            current: true,
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
            expiresAt: Date.now() + 60000,
          },
        ],
      })
    if (url.endsWith('/logout')) {
      assert.equal(options.headers['X-CSRF-Token'], account.csrfToken)
      authenticated = false
      return new Response(null, { status: 204 })
    }
    throw new Error('Unexpected authentication request')
  }
  let authRoot = createRoot(container)
  try {
    await test('authentication gate checks the server before showing the workspace', async () => {
      await act(async () => authRoot.render(createElement(AuthenticatedApp)))
      assert.ok(query('#account-username'))
      assert.ok(!container.querySelector('.workspace-main'))
      assert.match(text(), /Your master password/)
    })
    await test('private invitation fragments prefill registration and are removed from the address bar', async () => {
      await act(async () => authRoot.unmount())
      dom.history.replaceState(null, '', '/#/join/' + 'i'.repeat(43))
      authRoot = createRoot(container)
      await act(async () => authRoot.render(createElement(AuthenticatedApp)))
      assert.equal(query('#account-invitation').value, 'i'.repeat(43))
      assert.ok(!dom.location.hash.includes('i'.repeat(43)))
      assert.match(text(), /Create your Lockbox account/)
      assert.match(
        text(),
        /first administrator uses an administrator invitation/,
      )
    })
    await test('registration confirms passwords locally and then returns to sign in', async () => {
      await button('Create account')
      await change('#account-username', 'Primary')
      await change('#account-password', 'Fictional correct passphrase!')
      await change('#account-confirmation', 'A different fictional passphrase!')
      await change('#account-invitation', 'i'.repeat(43))
      const before = requests.length
      await submit()
      assert.match(query('[role="alert"]').textContent, /do not match/)
      assert.equal(requests.length, before)
      await change('#account-confirmation', 'Fictional correct passphrase!')
      await submit()
      assert.match(text(), /Account created/)
      assert.equal(query('#account-password').value, '')
      assert.ok(!container.querySelector('#account-invitation'))
      const registration = requests.find((item) =>
        item.url.endsWith('/register'),
      )
      assert.equal(
        JSON.parse(registration.options.body).passwordConfirmation,
        'Fictional correct passphrase!',
      )
    })
    async function waitFor(selector) {
      const deadline = Date.now() + 15000
      while (!container.querySelector(selector)) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for ' + selector)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
        })
      }
      return query(selector)
    }
    async function waitForText(pattern) {
      const deadline = Date.now() + 15000
      while (!pattern.test(text())) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for ' + pattern)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
        })
      }
    }
    await test('login recovery submits only a login code and returns to sign in without unlocking a vault', async () => {
      await button('Recover login')
      await change('#account-password', 'Fictional correct passphrase!')
      await change('#account-confirmation', 'Fictional correct passphrase!')
      await change('#account-invitation', 'r'.repeat(43))
      await submit()
      await waitForText(/Login password reset/)
      assert.ok(!container.querySelector('.workspace-main'))
      const sent = requests.find((x) => x.url.endsWith('/recover'))
      assert.equal(JSON.parse(sent.options.body).code, 'r'.repeat(43))
      assert.equal(query('#account-password').value, '')
    })
    await test('generic login errors are displayed; login alone does not unlock a vault', async () => {
      await change('#account-password', 'Incorrect fictional passphrase!')
      await submit()
      assert.match(query('[role="alert"]').textContent, /username or password/i)
      await change('#account-password', 'Fictional correct passphrase!')
      await submit()
      await waitFor('#vault-master')
      assert.match(text(), /Create a master password/)
      assert.ok(!container.querySelector('.workspace-main'))
      assert.equal(dom.localStorage.length, 0)
      assert.equal(dom.sessionStorage.length, 0)
    })
    await test('login recovery settings are accessible without unlocking or creating a vault', async () => {
      await button('Account recovery and Google Drive settings')
      assert.ok(query('#recovery-login-password'))
      assert.ok(!container.querySelector('.workspace-main'))
      await change('#recovery-login-password', 'Fictional correct passphrase!')
      await submit('#recovery-login-password')
      assert.equal(
        (await waitFor('[aria-label="Login recovery code"]')).value,
        'r'.repeat(43),
      )
      assert.equal(vaultState.profile, null)
      await button('Hide account and cloud settings')
      assert.ok(!container.querySelector('#recovery-login-password'))
    })
    await test('master setup requires confirmation and complete recovery-key verification before saving', async () => {
      await change('#vault-master', master)
      await change('#vault-confirmation', 'Different fictional UI passphrase!')
      await submit()
      assert.match(query('[role="alert"]').textContent, /do not match/)
      await change('#vault-confirmation', master)
      await submit()
      const recovery = await waitFor('[aria-label="New recovery key"]')
      uiRecovery = recovery.value
      assert.equal(vaultState.profile, null)
      await change('#vault-verification', '00'.repeat(32))
      await submit()
      assert.ok(query('[role="alert"]'))
      await change('#vault-verification', recovery.value)
      await submit()
      await waitFor('.workspace-main')
      assert.match(text(), /Welcome back, Primary/)
      assert.ok(!text().includes('Explore as a demo user'))
    })
    await test('credential forms save only ciphertext and survive a locked reload', async () => {
      await button('Add credential')
      await change('#credential-name', 'UI fictional private login')
      await change('#credential-url', 'https://ui-fictional.example')
      await change('#credential-username', 'UI private username')
      await change('#credential-password', 'UI fictional saved password!')
      await submit()
      await waitForText(/Encrypted vault saved/)
      assert.ok(
        !JSON.stringify(vaultState).includes('UI fictional saved password!'),
      )
      assert.ok(
        !JSON.stringify(
          requests.filter((item) => item.url.startsWith('/api/vault/')),
        ).includes('UI private username'),
      )
      assert.equal(dom.localStorage.length, 0)
      assert.equal(dom.sessionStorage.length, 0)
    })
    await test('reload restores login but requires master unlock; incorrect password stays locked', async () => {
      await act(async () => authRoot.unmount())
      authRoot = createRoot(container)
      await act(async () => authRoot.render(createElement(AuthenticatedApp)))
      await waitFor('#vault-master')
      assert.ok(!container.querySelector('.workspace-main'))
      assert.ok(!text().includes('UI fictional private login'))
      await change('#vault-master', 'Wrong fictional UI master passphrase!')
      await submit()
      await waitForText(/Incorrect master password/)
      assert.ok(!container.querySelector('.workspace-main'))
      await change('#vault-master', master)
      await submit()
      await waitFor('.workspace-main')
      assert.match(text(), /UI fictional private login/)
    })
    await test('settings expose real session, master and recovery controls without demo reset', async () => {
      await go('settings')
      assert.match(text(), /Chrome on Windows/)
      assert.match(text(), /This session/)
      assert.ok(query('#master-current'))
      assert.ok(query('#settings-recovery'))
      assert.ok(!text().includes('Reset demo data'))
    })
    await test('login recovery setup reveals its code after reauthentication without altering vault ciphertext', async () => {
      const before = vaultState.personal.payload.ciphertext
      await change('#recovery-login-password', 'Fictional correct passphrase!')
      await submit('#recovery-login-password')
      assert.equal(
        (await waitFor('[aria-label="Login recovery code"]')).value,
        'r'.repeat(43),
      )
      assert.equal(vaultState.personal.payload.ciphertext, before)
      assert.equal(query('#recovery-login-password').value, '')
      await button('I saved it — hide code')
      assert.ok(!container.querySelector('[aria-label="Login recovery code"]'))
    })
    await test('recovery guidance distinguishes lost proof and Settings exposes off-device custody controls', async () => {
      await change('#recovery-scenario', 'lost')
      assert.match(text(), /Personal decryption unrecoverable/)
      assert.ok(query('#backup-folder'))
      assert.ok(query('#backup-proof'))
      assert.match(text(), /Off-device protection is not configured/)
      await change('#recovery-scenario', 'login')
    })
    await test('administrator creates and hides an invitation without changing vault contents', async () => {
      const before = vaultState.personal.payload.ciphertext
      await change('#invite-password', 'Fictional correct passphrase!')
      await submit('#invite-password')
      assert.match(
        (await waitFor('[aria-label="Household invitation link"]')).value,
        /#\/join\/i{43}$/,
      )
      assert.equal(vaultState.personal.payload.ciphertext, before)
      assert.equal(query('#invite-password').value, '')
      await button('Hide invitation')
    })
    await test('Drive Settings reports deployment unavailability without asking for keys or console setup', async () => {
      await waitForText(/not available in this installation/)
      assert.ok(query('#drive-folder-link'))
      assert.ok(
        !text().includes('client secret') && !text().includes('API key'),
      )
      const connect = [...container.querySelectorAll('button')].find(
        (item) => item.textContent.trim() === 'Connect Google Drive',
      )
      assert.ok(connect.disabled)
    })
    await test('Drive connection starts real Google authorisation; connected status appears only after callback', async () => {
      driveState = { ...driveState, configured: true }
      await go('dashboard')
      await go('settings')
      await waitFor('#drive-folder-link')
      await waitForText(/NOT CONNECTED/)
      await change(
        '#drive-folder-link',
        'https://drive.google.com/drive/folders/fictional-folder-id',
      )
      let destination = ''
      const originalAssign = dom.location.assign
      Object.defineProperty(dom.location, 'assign', {
        value: (url) => {
          destination = url
        },
        configurable: true,
      })
      try {
        await button('Connect Google Drive')
        assert.equal(new URL(destination).origin, 'https://accounts.google.com')
        assert.equal(driveState.connected, false)
      } finally {
        Object.defineProperty(dom.location, 'assign', {
          value: originalAssign,
          configurable: true,
        })
      }
      const request = requests.findLast(
        (item) => item.url === '/api/drive/connect',
      )
      assert.equal(
        JSON.parse(request.options.body).folderLink,
        'https://drive.google.com/drive/folders/fictional-folder-id',
      )
      driveState = {
        ...driveState,
        connected: true,
        state: 'connected',
        account: 'fictional-owner@example.test',
        folder: { id: 'fictional-folder-id', name: 'Private household folder' },
      }
      await go('dashboard')
      await go('settings')
      await waitForText(/fictional-owner@example.test/)
      assert.match(text(), /Private household folder/)
    })
    await test('Drive Sync Now and Disconnect preserve the local encrypted vault', async () => {
      const ciphertext = vaultState.personal.payload.ciphertext
      await button('Sync Now')
      await waitForText(/Last successful sync/)
      assert.ok(driveState.lastSync)
      await button('Disconnect')
      assert.equal(driveState.connected, false)
      assert.equal(vaultState.personal.payload.ciphertext, ciphertext)
      assert.match(
        text(),
        /Your local vaults and encrypted cloud copies have been kept/,
      )
    })
    await test('manual lock clears credential UI and unlock restores encrypted data', async () => {
      await button('Lock vault')
      await waitFor('#vault-master')
      assert.ok(!container.querySelector('.workspace-main'))
      await change('#vault-master', master)
      await submit()
      await waitFor('.workspace-main')
      await go('library')
      assert.match(text(), /UI fictional private login/)
    })
    await test('Settings changes the master password without rewriting credential ciphertext', async () => {
      await go('settings')
      const ciphertext = vaultState.personal.payload.ciphertext
      await change('#master-current', master)
      await change('#master-new', changedMaster)
      await change('#master-confirm', changedMaster)
      await submit('#master-current')
      await waitForText(/Master password changed/)
      assert.equal(vaultState.personal.payload.ciphertext, ciphertext)
      await button('Lock vault')
      await waitFor('#vault-master')
      await change('#vault-master', master)
      await submit()
      await waitForText(/Incorrect master password/)
      await change('#vault-master', changedMaster)
      await submit()
      await waitFor('.workspace-main')
    })
    await test('recovery UI verifies a replacement recovery key before committing a new master password', async () => {
      await button('Lock vault')
      await waitFor('#vault-master')
      await button('Use a recovery key')
      await change('#vault-recovery', uiRecovery)
      await change('#vault-master', master)
      await change('#vault-confirmation', master)
      const ciphertext = vaultState.personal.payload.ciphertext,
        profile = JSON.stringify(vaultState.profile)
      await submit()
      const nextCode = await waitFor('[aria-label="New recovery key"]')
      assert.notEqual(nextCode.value, uiRecovery)
      assert.equal(JSON.stringify(vaultState.profile), profile)
      uiRecovery = nextCode.value
      await change('#vault-verification', uiRecovery)
      await submit()
      await waitFor('.workspace-main')
      assert.equal(vaultState.personal.payload.ciphertext, ciphertext)
      assert.ok(
        !JSON.stringify(
          requests.filter((item) => item.url.startsWith('/api/vault/')),
        ).includes(uiRecovery),
      )
    })
    await test('logout revokes through the API and returns to the signed-out screen', async () => {
      await button('Sign out')
      assert.equal(authenticated, false)
      assert.match(text(), /You have been signed out/)
      assert.ok(!container.querySelector('.workspace-main'))
    })
    await test('clipboard clears at 30 seconds and preserves unrelated clipboard contents', async (context) => {
      const { copySecret, clearSecretClipboard } = await server.ssrLoadModule(
        '/src/lib/secure-clipboard.ts',
      )
      Object.defineProperty(dom.navigator, 'clipboard', {
        value: {
          writeText: async (value) => {
            clipboard = value
          },
          readText: async () => clipboard,
        },
        configurable: true,
      })
      context.mock.timers.enable({ apis: ['setTimeout'] })
      const warnings = []
      await copySecret('Fictional clipboard password!', (message) =>
        warnings.push(message),
      )
      context.mock.timers.tick(29999)
      assert.equal(clipboard, 'Fictional clipboard password!')
      context.mock.timers.tick(1)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(clipboard, '')
      await copySecret('Another fictional password!', (message) =>
        warnings.push(message),
      )
      clipboard = 'Unrelated newly copied text'
      context.mock.timers.tick(30000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(clipboard, 'Unrelated newly copied text')
      await copySecret('Clear on lock fixture!', (message) =>
        warnings.push(message),
      )
      await clearSecretClipboard()
      assert.equal(clipboard, '')
      assert.equal(warnings.length, 0)
      Object.defineProperty(dom.navigator, 'clipboard', {
        value: {
          writeText: async (value) => {
            clipboard = value
          },
          readText: async () => {
            throw new Error('Permission blocked')
          },
        },
        configurable: true,
      })
      await copySecret('Permission-blocked fictional clipboard!', (message) =>
        warnings.push(message),
      )
      context.mock.timers.tick(30000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(warnings.length, 1)
      assert.match(warnings[0], /blocked/)
      assert.ok(!warnings[0].includes('fictional clipboard'))
    })
  } finally {
    await act(async () => authRoot.unmount())
    globalThis.fetch = originalFetch
  }
} finally {
  await server.close()
  await dom.happyDOM.close()
}
