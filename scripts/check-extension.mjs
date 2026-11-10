import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { inspectForm } from '../extension/forms.mjs'
import { parseExtensionRequest, websiteOrigin } from '../shared/extension.ts'
const dom = new Window({ url: 'https://lockbox.example.invalid/#/settings' })
for (const key of [
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLDialogElement',
  'Event',
  'MouseEvent',
  'MutationObserver',
  'Node',
  'location',
])
  Object.defineProperty(globalThis, key, {
    value: dom[key],
    configurable: true,
  })
Object.defineProperty(globalThis, 'window', { value: dom, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createElement, act } = await import('react'),
  { createRoot } = await import('react-dom/client')
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
})
const { ExtensionBridge } = await server.ssrLoadModule(
  '/src/features/extension/extension-bridge.tsx',
)
const id = 'a'.repeat(64),
  origin = 'https://example.invalid',
  request = {
    v: 1,
    kind: 'lockbox-extension-request',
    id,
    operation: 'fill',
    origin,
  }
const container = dom.document.createElement('div')
dom.document.body.append(container)
const root = createRoot(container),
  responses = [],
  saves = [],
  credentials = [
    {
      id: 'matching',
      name: 'Example',
      url: origin + '/login',
      username: 'FictionalUser',
      password: 'Fictional extension test password',
      vault: 'personal',
      category: 'Personal',
      notes: 'keep',
      owner: 'emmanuel',
    },
    {
      id: 'wrong-origin',
      name: 'Other',
      url: 'https://other.example.invalid',
      username: 'OtherUser',
      password: 'Never send this',
      vault: 'personal',
    },
  ]
const engine = {
  locked: false,
  credentials,
  saveCredential: async (...args) => {
    saves.push(args)
  },
}
dom.postMessage = (value) => {
  responses.push(value)
}
const send = async (data, messageOrigin = dom.location.origin, source = dom) =>
  act(async () => {
    dom.dispatchEvent(
      new dom.MessageEvent('message', { data, origin: messageOrigin, source }),
    )
  })
const click = async (label) =>
  act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === label,
    )
    assert.ok(button, label)
    button.click()
  })
const select = async () =>
  act(async () => {
    const select = container.querySelector('select')
    assert.ok(select)
    select.value = 'matching'
    select.dispatchEvent(new dom.Event('change', { bubbles: true }))
  })
try {
  await test('extension protocol requires canonical HTTPS origins, exact fields and bounded captured logins', () => {
    assert.equal(websiteOrigin(origin + '/path'), origin)
    assert.equal(parseExtensionRequest(request).origin, origin)
    for (const value of [
      { ...request, origin: 'http://example.invalid' },
      { ...request, origin: origin + '/path' },
      { ...request, id: 'short' },
      { ...request, extra: 'unexpected' },
      { ...request, operation: 'save' },
      { ...request, entry: { password: 'unexpected' } },
    ])
      assert.throws(() => parseExtensionRequest(value))
    assert.throws(() => websiteOrigin('https://user:secret@example.invalid'))
  })
  await test('form detection, capture and generation require exact origins, explicit approval and new-password markers; no submission', () => {
    const page = new Window({ url: origin + '/register' })
    page.document.title = 'Fictional registration'
    page.document.body.innerHTML =
      '<form action="/register"><input autocomplete="username" name="username" value="FictionalUser"><input type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"></form>'
    page.HTMLInputElement.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 20,
    })
    const run = page.eval('(' + inspectForm.toString() + ')')
    let submits = 0
    page.document
      .querySelector('form')
      .addEventListener('submit', () => submits++)
    assert.equal(run(origin).registration, true)
    assert.ok(
      run('https://other.example.invalid', 'fill', {
        approved: true,
        username: 'x',
        password: 'y',
      }).error,
    )
    assert.ok(
      run(origin, 'generate', { password: 'Fictional secure generated 123!' })
        .error,
    )
    assert.equal(
      run(origin, 'generate', {
        approved: true,
        password: 'Fictional secure generated 123!',
      }).inserted,
      true,
    )
    assert.equal(
      run(origin, 'capture').entry.password,
      'Fictional secure generated 123!',
    )
    page.document.querySelectorAll('[type=password]')[1].value = 'different'
    assert.ok(run(origin, 'capture').error)
    page.document.querySelector('form').action = 'https://other.example.invalid'
    assert.ok(
      run(origin, 'fill', { approved: true, username: 'x', password: 'y' })
        .error,
    )
    assert.equal(submits, 0)
    page.happyDOM.abort()
  })
  await test('extension refuses ambiguous forms, hidden passwords and ambiguous password changes', () => {
    const page = new Window({ url: origin })
    page.HTMLInputElement.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 20,
    })
    const run = page.eval('(' + inspectForm.toString() + ')')
    page.document.body.innerHTML =
      '<form><input name="username" value="user"><input type="password" value="old"><input type="password" value="new"><input type="password" value="new"></form>'
    assert.ok(run(origin, 'capture').error)
    assert.ok(
      run(origin, 'generate', {
        approved: true,
        password: 'Fictional generated password',
      }).error,
    )
    page.document.body.innerHTML =
      '<form><input type="password"></form><form><input type="password"></form>'
    assert.ok(run(origin).error)
    page.HTMLInputElement.prototype.getBoundingClientRect = () => ({
      width: 0,
      height: 0,
    })
    assert.ok(run(origin).error)
    page.happyDOM.abort()
  })
  await test('disabled bridge ignores requests; enabled bridge rejects foreign messages and discloses only explicitly selected exact-origin login', async () => {
    await act(async () =>
      root.render(
        createElement(ExtensionBridge, {
          engine,
          user: 'emmanuel',
          onChanged: () => {},
        }),
      ),
    )
    await send(request)
    assert.equal(container.querySelector('dialog'), null)
    assert.equal(responses.length, 0)
    await act(async () =>
      container.querySelector('input[type=checkbox]').click(),
    )
    await send(request, 'https://attacker.invalid')
    assert.equal(container.querySelector('dialog'), null)
    await send(request, dom.location.origin, null)
    assert.equal(container.querySelector('dialog'), null)
    await send(request)
    assert.ok(container.querySelector('dialog'))
    assert.equal(responses.length, 0)
    assert.equal(container.querySelectorAll('option').length, 2)
    await select()
    await click('Approve fill')
    assert.equal(responses.at(-1).password, credentials[0].password)
    assert.equal(responses.at(-1).origin, origin)
    assert.equal(JSON.stringify(responses).includes('Never send this'), false)
  })
  await test('save, update and cancellation require approval; updates preserve notes and vault; no persistent browser credentials', async () => {
    const entry = {
      name: 'Captured fictional login',
      username: 'UpdatedUser',
      password: 'Updated fictional password',
    }
    await send({ ...request, operation: 'save', entry })
    assert.equal(saves.length, 0)
    await click('Cancel')
    assert.equal(saves.length, 0)
    assert.equal(responses.at(-1).approved, false)
    await send({ ...request, operation: 'save', entry })
    await click('Approve save')
    assert.equal(saves.length, 1)
    assert.equal(saves[0][0].vault, 'personal')
    await send({ ...request, operation: 'update', entry })
    await select()
    await click('Approve update')
    assert.equal(saves[1][1], 'matching')
    assert.equal(saves[1][0].notes, 'keep')
    assert.equal(saves[1][0].password, entry.password)
    assert.equal(dom.localStorage.length, 0)
    assert.equal(dom.sessionStorage.length, 0)
    engine.locked = true
    await send(request)
    assert.equal(container.querySelector('dialog'), null)
  })
  await test('candidate manifest grants no permanent target websites, broad mandatory host access, cookie or clipboard access', () => {
    const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))
    assert.deepEqual(manifest.permissions, [
      'activeTab',
      'scripting',
      'storage',
    ])
    assert.equal(manifest.host_permissions, undefined)
    assert.equal(manifest.content_scripts, undefined)
    assert.equal(manifest.externally_connectable, undefined)
    assert.deepEqual(manifest.optional_host_permissions, ['https://*/*'])
  })
} finally {
  await act(async () => root.unmount())
  await server.close()
  await dom.happyDOM.abort()
}
