import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  shell,
  safeStorage,
  session,
} from 'electron'
import { join, resolve, dirname, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
import { ensurePrivateDirectory } from '../../../server/security/private-files.ts'
import { PrivateStore } from './store.mjs'
import { Replica } from './replica.mjs'
import {
  GoogleConnection,
  nativeAuthorization,
  validateConfiguration,
  FILE_SCOPE,
} from './oauth.mjs'
import { NativeDrive } from './drive.mjs'
import { check } from './errors.mjs'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lockbox-proof',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])
const arg = (name) =>
  process.argv
    .find((value) => value.startsWith('--' + name + '='))
    ?.slice(name.length + 3)
const diagnostic = process.argv.includes('--diagnostic'),
  renderCheck = process.argv.includes('--render-check'),
  role = arg('role') ?? 'owner',
  profileId = arg('profile') ?? 'owner'
check(
  /^[a-z0-9-]{1,50}$/.test(profileId) && ['owner', 'partner'].includes(role),
)
let directory
if (diagnostic || renderCheck) {
  const root = resolve(arg('test-root') ?? '')
  check(
    /^lockbox-native-proof-test-[a-f0-9-]{36}$/.test(
      root.split(/[\\/]/).at(-1),
    ),
    'PROOF_DIAGNOSTIC_ROOT_REQUIRED',
  )
  directory = join(root, profileId)
} else
  directory = join(
    app.getPath('appData'),
    'LockboxFeasibilityProof-v1',
    profileId,
  )
ensurePrivateDirectory(directory)
app.setPath('userData', join(directory, 'browser'))
ensurePrivateDirectory(app.getPath('userData'))
const here = dirname(fileURLToPath(import.meta.url)),
  rendererRoot = resolve(here, '../renderer')
let window,
  replica,
  connection,
  configuration = null,
  lastError = '',
  syncTimer
const code = (error) =>
  /^PROOF_[A-Z_]+$/.test(error?.code ?? '')
    ? error.code
    : 'PROOF_OPERATION_FAILED'
let diagnosticChannel
const report = (value) =>
  (diagnosticChannel ?? process.stdout).write(
    '@@LOCKBOX@@' + JSON.stringify(value) + '\n',
  )
const pending = new Map()
let sequence = 0
const diagnosticFetch = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    report({
      transport: id,
      url: String(url),
      options: {
        ...options,
        body:
          options.body instanceof URLSearchParams
            ? options.body.toString()
            : options.body,
        signal: undefined,
      },
    })
  })
async function start() {
  await app.whenReady()
  const protector = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (bytes) => safeStorage.decryptString(bytes),
  }
  const store = new PrivateStore(directory, protector)
  function drive() {
    if (diagnostic)
      return new NativeDrive(
        { access: async () => 'fictional-' + profileId },
        { fetch: diagnosticFetch, sleep: async () => {} },
      )
    check(connection, 'PROOF_GOOGLE_NOT_CONNECTED')
    return new NativeDrive(connection)
  }
  replica = new Replica(store, role, drive)
  if (!diagnostic) {
    const configFile = join(here, '../public-config.json')
    if (existsSync(configFile))
      configuration = validateConfiguration(
        JSON.parse(readFileSync(configFile, 'utf8')),
      )
    if (configuration && replica.data.tokens)
      connection = new GoogleConnection(
        configuration,
        replica.data.tokens,
        (tokens) => {
          replica.data.tokens = tokens
          replica.save()
        },
      )
  }
  const status = () => ({
    ...replica.status(),
    googleConfigured: diagnostic ? false : Boolean(configuration),
    scope: configuration?.scope ?? FILE_SCOPE,
    lastError,
    simulated: diagnostic,
  })
  async function sync() {
    try {
      await replica.sync()
      lastError = ''
      return status()
    } catch (error) {
      lastError = code(error)
      throw error
    }
  }
  function schedule() {
    if (diagnostic) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      if (connection && replica.data.folders) void sync().catch(() => {})
    }, 750)
  }
  async function dispatch(action, payload) {
    check(JSON.stringify(payload ?? null).length < 2000000, 'PROOF_INPUT_LIMIT')
    if (action === 'renderer-ready') {
      if (renderCheck) {
        writeFileSync(
          join(directory, 'renderer-ready.json'),
          JSON.stringify({ ready: true, backendUsed: false }),
        )
        setTimeout(() => app.quit(), 100)
      }
      return true
    }
    if (action === 'status') return status()
    if (action === 'api') {
      const result = replica.api(payload.path, payload.body)
      if (payload.path !== 'state') schedule()
      return result
    }
    if (action === 'connect') {
      check(
        !diagnostic && configuration,
        'PROOF_DEVELOPER_GOOGLE_CLIENT_REQUIRED',
      )
      const tokens = await nativeAuthorization(configuration, {
        open: (url) => shell.openExternal(url),
        pickFolders: replica.data.folders
          ? [replica.data.folders.personal, replica.data.folders.shared]
          : [],
      })
      const fresh = new GoogleConnection(configuration, tokens, () => {}),
        account = await new NativeDrive(fresh).account()
      if (replica.data.google)
        check(
          replica.data.google.permissionId === account.permissionId,
          'PROOF_GOOGLE_ACCOUNT_CHANGED',
        )
      tokens.refresh ??= replica.data.tokens?.refresh
      check(
        typeof tokens.refresh === 'string',
        'PROOF_GOOGLE_REFRESH_GRANT_REQUIRED',
      )
      replica.account(account)
      replica.data.tokens = tokens
      replica.save()
      connection = new GoogleConnection(configuration, tokens, (next) => {
        replica.data.tokens = next
        replica.save()
      })
      return status()
    }
    if (action === 'create-folders') return replica.createFolders()
    if (action === 'pairing') return replica.pairing()
    if (action === 'grant')
      return replica.grant(
        payload.pairing,
        payload.fingerprint,
        payload.householdCode,
      )
    if (action === 'export-grant') {
      check(
        replica.data.role === 'owner' && replica.data.grantPacket,
        'PROOF_INVITATION_REQUIRED',
      )
      return replica.data.grantPacket
    }
    if (action === 'import-grant')
      return replica.importGrant(payload.packet, payload.fingerprint)
    if (action === 'household-code') return replica.householdCode()
    if (action === 'sync') return sync()
    if (diagnostic && action === 'diagnostic-account') {
      check(payload.emailAddress.endsWith('@example.invalid'))
      replica.account(payload)
      return status()
    }
    throw new Error('Unsupported proof action')
  }
  if (diagnostic) {
    const pipe = arg('test-pipe')
    check(
      /^lockbox-proof-[a-f0-9-]{36}$/.test(pipe ?? ''),
      'PROOF_DIAGNOSTIC_PIPE_REQUIRED',
    )
    diagnosticChannel = createConnection('\\\\.\\pipe\\' + pipe)
    await new Promise((resolve, reject) => {
      diagnosticChannel.once('connect', resolve)
      diagnosticChannel.once('error', reject)
    })
    const input = createInterface({ input: diagnosticChannel })
    input.on('line', (line) => {
      try {
        const message = JSON.parse(line)
        if (message.transport) {
          const waiter = pending.get(message.transport)
          pending.delete(message.transport)
          if (message.error)
            waiter?.reject(new Error('Fictional offline transport'))
          else
            waiter?.resolve(
              new Response(JSON.stringify(message.body), {
                status: message.status,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          return
        }
        if (message.action === 'close') {
          report({ id: message.id, ok: true, value: { closed: true } })
          app.quit()
          return
        }
        void dispatch(message.action, message.payload)
          .then((value) => report({ id: message.id, ok: true, value }))
          .catch((error) =>
            report({ id: message.id, ok: false, code: code(error) }),
          )
      } catch {
        report({ ok: false, code: 'PROOF_DIAGNOSTIC_INPUT_INVALID' })
      }
    })
    report({
      ready: true,
      osEncryptionAvailable: protector.available(),
      role,
      simulated: true,
    })
  } else {
    const csp =
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    protocol.handle('lockbox-proof', async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'app' || request.method !== 'GET')
        return new Response('Denied', { status: 403 })
      const name = decodeURIComponent(url.pathname),
        file = resolve(
          rendererRoot,
          '.' + (name === '/' ? '/index.html' : name),
        )
      if (!file.startsWith(rendererRoot + sep))
        return new Response('Denied', { status: 403 })
      try {
        const types = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.wasm': 'application/wasm',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
        }
        return new Response(readFileSync(file), {
          headers: {
            'Content-Type': types[extname(file)] ?? 'application/octet-stream',
            'Content-Security-Policy': csp,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
        })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    )
    session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !details.url.startsWith('lockbox-proof://app/') }),
    )
    window = new BrowserWindow({
      title: 'LOCKBOX — Fictional native proof — ' + profileId,
      width: 1360,
      height: 920,
      webPreferences: {
        preload: join(here, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('lockbox-proof://app/')) event.preventDefault()
    })
    ipcMain.handle('lockbox-proof', async (event, action, payload) => {
      try {
        check(
          event.sender === window.webContents &&
            event.senderFrame === event.sender.mainFrame &&
            event.senderFrame.url.startsWith('lockbox-proof://app/'),
          'PROOF_CALLER_REJECTED',
        )
        return { ok: true, value: await dispatch(action, payload) }
      } catch (error) {
        return { ok: false, code: code(error) }
      }
    })
    await window.loadURL('lockbox-proof://app/')
  }
}
void start().catch(() => {
  process.stderr.write('PROOF_STARTUP_FAILED\n')
  app.exit(1)
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => clearTimeout(syncTimer))
