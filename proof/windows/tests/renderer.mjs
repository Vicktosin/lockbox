import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { Replica } from '../native/replica.mjs'
import { SecretClipboard } from '../native/secret-clipboard.mjs'
import { clone } from '../native/identity.mjs'
// A simulated DOM and in-memory native transport. No browser automation, real clipboard, Drive or backend.
const dom = new Window({ url: 'https://lockbox-preview.example.invalid/' })
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
])
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? dom : dom[key],
    configurable: true,
  })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createElement, act } = await import('react'),
  { createRoot } = await import('react-dom/client')
let configuredRegistration = false
let verifiedRecovery = ''
let record = null,
  clipboard = '',
  lastBackup = null
const replica = new Replica(
  {
    load: () => record && clone(record),
    save: (data) => {
      record = clone(data)
    },
  },
  'owner',
  () => {
    throw new Error('No Google connection in UI test')
  },
)
const nativeClipboard = new SecretClipboard({
  readText: () => clipboard,
  writeText: (value) => {
    clipboard = value
  },
})
replica.onLocked = () => nativeClipboard.clear()
const calls = []
dom.lockboxProof = {
  request: async (action, payload) => {
    calls.push({ action, payload: clone(payload) })
    if (action === 'status')
      return {
        ...replica.status(),
        googleConfigured: configuredRegistration,
        googleTestMode: false,
        liveSyncAllowed: false,
        googleAuthorising: false,
        securityBlockers: [],
        googleConnected: false,
        lastError: '',
        scope: 'https://www.googleapis.com/auth/drive.file',
      }
    if (action === 'google-test-report')
      return {
        format: 'lockbox-google-test-report-v1',
        integrationComplete: false,
        simulated: true,
        twoPhysicalComputersVerified: false,
      }
    if (action === 'renderer-ready') return true
    if (action === 'api')
      return replica.api(payload.path, payload.body, payload.setupRoot)
    if (action === 'unlock-identity')
      return replica.unlockIdentity(payload.root)
    if (action === 'lock-identity') return replica.lockIdentity()
    if (action === 'touch-identity') return replica.touchIdentity()
    if (action === 'clipboard-copy') {
      nativeClipboard.copy(payload.value)
      return true
    }
    if (action === 'clipboard-clear') {
      nativeClipboard.clear()
      return true
    }
    if (action === 'history') return replica.historyVersions(payload.scope)
    if (action === 'conflicts') return replica.conflictVersions(payload.scope)
    if (action === 'resolve-conflict')
      return replica.resolveConflict(
        payload.scope,
        payload.selected,
        payload.expectedHeads,
      )
    if (action === 'backup-export') {
      lastBackup = replica.exportBackup(payload.root)
      return { saved: true }
    }
    throw new Error('Unexpected native action: ' + action)
  },
}
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  throw new Error('A desktop UI operation attempted HTTP')
}
const server = await createServer({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
})
const { WindowsLockbox } = await server.ssrLoadModule(
  '/proof/windows/renderer/main.tsx',
)
const container = dom.document.createElement('div')
dom.document.body.append(container)
let root = createRoot(container)
const master = 'Fictional UI Windows master 123!'
const q = (selector) => {
  const node = container.querySelector(selector)
  assert.ok(node, 'Missing element: ' + selector)
  return node
}
const text = () => container.textContent
async function button(label) {
  const node = [...container.querySelectorAll('button')].find(
    (b) =>
      b.textContent.trim() === label || b.getAttribute('aria-label') === label,
  )
  assert.ok(node, 'Missing button: ' + label)
  await act(async () => node.click())
}
async function go(page) {
  await act(async () => {
    dom.location.hash = '/' + page
    dom.dispatchEvent(new dom.HashChangeEvent('hashchange'))
  })
}
async function change(selector, value) {
  const node = q(selector),
    proto =
      node.tagName === 'SELECT'
        ? dom.HTMLSelectElement.prototype
        : node.tagName === 'TEXTAREA'
          ? dom.HTMLTextAreaElement.prototype
          : dom.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
    node.dispatchEvent(
      new dom.Event(node.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    )
  })
}
async function submit(selector) {
  await act(async () =>
    q(selector)
      .closest('form')
      .dispatchEvent(
        new dom.Event('submit', { bubbles: true, cancelable: true }),
      ),
  )
}
async function until(predicate) {
  const limit = Date.now() + 10000
  while (!predicate()) {
    if (Date.now() > limit) throw new Error('UI operation timed out')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
  }
}
try {
  await test('native setup creates an empty encrypted vault with verified recovery and no HTTP account service', async () => {
    await act(async () => root.render(createElement(WindowsLockbox)))
    await until(() => container.querySelector('#proof-master'))
    assert.match(text(), /Windows/)
    await change('#proof-master', master)
    await change('#proof-confirm', master)
    await submit('#proof-master')
    await until(() =>
      container.querySelector('[aria-label="Fictional proof recovery key"]'),
    )
    const recovery = q('[aria-label="Fictional proof recovery key"]').value
    verifiedRecovery = recovery
    assert.equal(replica.state().profile, null)
    await change('#proof-recovery', recovery)
    await button('Confirm recovery and create local vault')
    await until(() => text().includes('Your vault starts here'))
    assert.equal(replica.state().personal.revision, 1)
    assert.equal(
      container.querySelector('[aria-label="Connect my Google account"]')
        ?.disabled ??
        [...container.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Connect my Google account',
        ).disabled,
      true,
    )
  })
  await test('registration alone cannot enable ordinary-vault uploads and exported reports never claim physical success', async () => {
    configuredRegistration = true
    await button('Refresh local vault')
    const connect = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Connect my Google account',
    )
    assert.equal(connect.disabled, true)
    await button('Settings, sharing and recovery')
    assert.match(text(), /Live uploads from existing vaults remain blocked/)
    await button('Prepare safe Google test report')
    await until(() =>
      container.querySelector('[aria-label="Safe Google test report"]'),
    )
    const report = JSON.parse(q('[aria-label="Safe Google test report"]').value)
    assert.equal(report.integrationComplete, false)
    assert.equal(report.twoPhysicalComputersVerified, false)
    configuredRegistration = false
    await go('dashboard')
  })
  await test('normal Add opens a blank form; save, reveal, native copy, edit and delete operate on encrypted local data', async () => {
    await button('Add credential')
    assert.equal(q('#credential-name').value, '')
    await change('#credential-name', 'Fictional Windows account')
    await change('#credential-url', 'https://example.invalid')
    await change('#credential-username', 'fictional@example.invalid')
    await change('#credential-password', 'Fictional-UI-saved-secret')
    await submit('#credential-name')
    await until(() => !container.querySelector('dialog'))
    assert.match(text(), /Fictional Windows account/)
    assert.equal(
      JSON.stringify(record).includes('Fictional-UI-saved-secret'),
      false,
    )
    const entry = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Fictional Windows account'),
    )
    if (entry) await act(async () => entry.click())
    else await act(async () => q('tbody tr').click())
    await until(() => container.querySelector('dialog'))
    await button('Show password')
    assert.equal(q('[aria-label="Credential password"]').type, 'text')
    await button('Copy password')
    assert.equal(clipboard, 'Fictional-UI-saved-secret')
    await button('Edit credential')
    await change('#credential-name', 'Fictional Windows edited')
    await submit('#credential-name')
    await until(() => !container.querySelector('dialog'))
    const edited = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Fictional Windows edited'),
    )
    if (edited) await act(async () => edited.click())
    else await act(async () => q('tbody tr').click())
    await button('Delete')
    await button('Delete credential')
    await until(() => !container.querySelector('dialog'))
    assert.equal(text().includes('Fictional Windows edited'), false)
  })
  await test('Household creation, folder organisation and password-generator use work offline without demo insertion', async () => {
    await button('Settings, sharing and recovery')
    await button('Create encrypted Household Vault')
    await until(() => Boolean(replica.state().household))
    await go('library')
    await change('[aria-label="Folder name"]', 'Fictional folder')
    await submit('[aria-label="Folder name"]')
    await until(() => text().includes('Fictional folder'))
    await go('generator')
    await button('Use in a new credential')
    assert.ok(q('#credential-password').value.length >= 16)
    assert.equal(q('#credential-name').value, '')
    await button('Cancel')
  })
  await test('security settings verify recovery, export portable backup, and preserve credentials across lock and reload', async () => {
    await button('Settings, sharing and recovery')
    await change('#desktop-recovery', verifiedRecovery)
    await submit('#desktop-recovery')
    await until(() => text().includes('Recovery key verified locally'))
    await change('#desktop-backup-master', master)
    await submit('#desktop-backup-master')
    await until(() => Boolean(lastBackup))
    assert.equal(JSON.stringify(lastBackup).includes(master), false)
    const snapshots = replica.data.journal.personal.length
    await button('Lock vault')
    await until(() => container.querySelector('#proof-master'))
    assert.equal(clipboard, '')
    await change('#proof-master', 'Fictional wrong master 456!')
    await submit('#proof-master')
    await until(() => text().includes('Incorrect'))
    assert.equal(replica.status().identityUnlocked, false)
    await change('#proof-master', master)
    await submit('#proof-master')
    await until(() => text().includes('Settings, sharing and recovery'))
    assert.equal(replica.data.journal.personal.length, snapshots)
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(createElement(WindowsLockbox)))
    await until(() => container.querySelector('#proof-master'))
    assert.equal(replica.status().identityUnlocked, false)
    assert.equal(
      calls.some((c) => JSON.stringify(c.payload ?? null).includes(master)),
      false,
    )
  })
} finally {
  await act(async () => root.unmount())
  nativeClipboard.clear()
  replica.lockIdentity()
  globalThis.fetch = originalFetch
  await server.close()
  await dom.happyDOM.close()
}
