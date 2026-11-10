// Electron sandbox preloads support CommonJS; ESM imports are unavailable here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron')
const allowed = new Set([
  'status',
  'renderer-ready',
  'api',
  'connect',
  'create-folders',
  'pairing',
  'grant',
  'export-grant',
  'import-grant',
  'household-code',
  'sync',
])
contextBridge.exposeInMainWorld('lockboxProof', {
  request: async (action, payload) => {
    if (!allowed.has(action)) throw new Error('Unsupported proof action')
    const response = await ipcRenderer.invoke('lockbox-proof', action, payload)
    if (!response.ok) throw new Error(response.code)
    return response.value
  },
})
