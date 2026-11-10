import {
  generatePassword,
  defaultOptions,
} from '../src/features/generator/generate-password.ts'
import { websiteOrigin } from '../shared/extension.ts'
import { inspectForm } from './forms.mjs'
const status = document.getElementById('status'),
  site = document.getElementById('site'),
  app = document.getElementById('app'),
  password = document.getElementById('password')
let tabId, origin
const run = async (fn) => {
  try {
    await fn()
  } catch (error) {
    status.textContent = error.message || 'Request failed.'
  }
}
void run(async () => {
  app.value = (await chrome.storage.local.get('appOrigin')).appOrigin ?? ''
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id
  origin = websiteOrigin(tab.url)
  site.textContent = 'Website: ' + origin
  const result = (
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: inspectForm,
      args: [origin],
    })
  )[0]?.result
  site.textContent +=
    ' — ' +
    (result?.error ??
      (result?.registration
        ? 'new-password form detected'
        : 'login form detected'))
})
document.getElementById('configure').onsubmit = (event) => {
  event.preventDefault()
  void run(async () => {
    const allowed = websiteOrigin(app.value.trim())
    const granted = await chrome.permissions.request({
      origins: [allowed + '/*'],
    })
    if (!granted) throw new Error('Permission was not granted.')
    await chrome.storage.local.set({ appOrigin: allowed })
    app.value = allowed
    status.textContent =
      'Lockbox address saved. Unlock it and enable extension preview in Settings.'
  })
}
for (const operation of ['fill', 'save', 'update'])
  document.getElementById(operation).onclick = () =>
    void run(async () => {
      if (!tabId || !origin) throw new Error('Open a supported HTTPS website.')
      status.textContent =
        'Continue in Lockbox and explicitly approve the request. Nothing is filled silently.'
      const result = await chrome.runtime.sendMessage({ operation, tabId })
      status.textContent = result.error ?? result.message
    })
document.getElementById('generate').onclick = () =>
  void run(() => {
    password.value = generatePassword({
      ...defaultOptions,
      length: Number(document.getElementById('length').value),
    })
    document.getElementById('approve-generation').checked = false
  })
document.getElementById('insert').onclick = () =>
  void run(async () => {
    if (
      !document.getElementById('approve-generation').checked ||
      !password.value
    )
      throw new Error(
        'Generate a password and explicitly approve insertion first.',
      )
    const result = (
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: inspectForm,
        args: [
          origin,
          'generate',
          { approved: true, password: password.value },
        ],
      })
    )[0]?.result
    if (result?.error) throw new Error(result.error)
    password.value = ''
    document.getElementById('approve-generation').checked = false
    status.textContent =
      'Generated password inserted. Submit the website form yourself, then choose Save this entered login.'
  })
