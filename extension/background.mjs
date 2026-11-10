import { inspectForm } from './forms.mjs'
import { websiteOrigin } from '../shared/extension.ts'
async function approvalInApp(appOrigin, request) {
  const candidates = await chrome.tabs.query({}),
    existing = candidates.find((tab) => {
      try {
        return websiteOrigin(tab.url) === appOrigin
      } catch {
        return false
      }
    })
  const tab = existing
    ? await chrome.tabs.update(existing.id, {
        active: true,
        url: appOrigin + '/#/settings',
      })
    : await chrome.tabs.create({ url: appOrigin + '/#/settings', active: true })
  for (let n = 0; n < 100; n++) {
    const ready = await chrome.tabs.get(tab.id)
    if (ready.status === 'complete') break
    await new Promise((r) => setTimeout(r, 100))
  }
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [0] },
    func: async (origin, request) => {
      if (location.origin !== origin || location.protocol !== 'https:')
        return { approved: false, error: 'Lockbox origin changed.' }
      return new Promise((resolve) => {
        let sent = false
        const finish = (value) => {
          clearTimeout(timer)
          window.removeEventListener('message', receive)
          resolve(value)
        }
        const receive = (event) => {
          if (
            event.source !== window ||
            event.origin !== origin ||
            event.data?.id !== request.id
          )
            return
          if (event.data.kind === 'lockbox-extension-ready' && !sent) {
            sent = true
            window.postMessage(request, origin)
          } else if (event.data.kind === 'lockbox-extension-response')
            finish(event.data)
        }
        window.addEventListener('message', receive)
        const timer = setTimeout(
          () =>
            finish({
              approved: false,
              error:
                'Unlock Lockbox and enable its extension preview in Settings, then retry.',
            }),
          45000,
        )
        window.postMessage(
          { kind: 'lockbox-extension-hello', id: request.id },
          origin,
        )
      })
    },
    args: [appOrigin, request],
  })
  return result[0]?.result
}
let busy = false
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    sender.url !== chrome.runtime.getURL('popup.html')
  )
    return false
  if (busy) {
    respond({ error: 'Finish the current request first.' })
    return false
  }
  busy = true
  ;(async () => {
    const appOrigin = websiteOrigin(
        (await chrome.storage.local.get('appOrigin')).appOrigin,
      ),
      tab = await chrome.tabs.get(message.tabId),
      origin = websiteOrigin(tab.url)
    if (origin === appOrigin)
      throw new Error('Open the website you want to use, not Lockbox itself.')
    if (!['fill', 'save', 'update'].includes(message.operation))
      throw new Error('Unsupported request.')
    const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
      x.toString(16).padStart(2, '0'),
    ).join('')
    let entry
    if (message.operation !== 'fill') {
      const result = (
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          func: inspectForm,
          args: [origin, 'capture'],
        })
      )[0]?.result
      if (result?.error) throw new Error(result.error)
      entry = result?.entry
    }
    const approved = await approvalInApp(appOrigin, {
      v: 1,
      kind: 'lockbox-extension-request',
      id,
      operation: message.operation,
      origin,
      ...(entry ? { entry } : {}),
    })
    if (!approved?.approved)
      throw new Error(approved?.error || 'Request cancelled in Lockbox.')
    if (message.operation === 'fill') {
      if (
        approved.origin !== origin ||
        typeof approved.username !== 'string' ||
        typeof approved.password !== 'string'
      )
        throw new Error('Invalid approval response.')
      if (websiteOrigin((await chrome.tabs.get(tab.id)).url) !== origin)
        throw new Error('The website changed; no credentials were filled.')
      const result = (
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          func: inspectForm,
          args: [
            origin,
            'fill',
            {
              approved: true,
              username: approved.username,
              password: approved.password,
            },
          ],
        })
      )[0]?.result
      approved.password = ''
      if (result?.error) throw new Error(result.error)
      await chrome.tabs.update(tab.id, { active: true })
      return {
        ok: true,
        message: 'Approved login filled. Nothing was submitted.',
      }
    }
    return { ok: true, message: 'Approved change saved in Lockbox.' }
  })()
    .then(respond)
    .catch((error) =>
      respond({
        error:
          error.message || 'Operation failed. No automatic fill was performed.',
      }),
    )
    .finally(() => {
      busy = false
    })
  return true
})
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
})
