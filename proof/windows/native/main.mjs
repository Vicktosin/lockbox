import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  shell,
  safeStorage,
  session,
  dialog,
  clipboard,
} from 'electron'
import { join, resolve, dirname, sep, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readFileSync,
  existsSync,
  writeFileSync,
  lstatSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  mkdirSync,
  renameSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
import { ensurePrivateDirectory } from '../../../server/security/private-files.ts'
import { PrivateStore } from './store.mjs'
import { backupHeader, backupDestination } from './portable-backup.mjs'
import { SecretClipboard } from './secret-clipboard.mjs'
import { installFiles } from './install.mjs'
import { hash } from './identity.mjs'
import { Replica } from './replica.mjs'
import { validateConfiguration, FILE_SCOPE } from './oauth.mjs'
import { GoogleSession } from './google-session.mjs'
import { assertCloudMode, cloudBlockers } from './cloud-policy.mjs'
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
  googleTest = process.argv.includes('--google-test'),
  profileRoot = googleTest
    ? 'LockboxGoogleDriveTest-v1'
    : 'LockboxFeasibilityProof-v1',
  selectionPath = join(
    app.getPath('appData'),
    profileRoot,
    'installation-role.json',
  ),
  selectedRole =
    !diagnostic && !renderCheck && existsSync(selectionPath)
      ? JSON.parse(readFileSync(selectionPath, 'utf8')).role
      : 'owner',
  role = arg('role') ?? selectedRole,
  profileId = arg('profile') ?? role
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
} else directory = join(app.getPath('appData'), profileRoot, profileId)
ensurePrivateDirectory(directory)
app.setPath('userData', join(directory, 'browser'))
ensurePrivateDirectory(app.getPath('userData'))
const here = dirname(fileURLToPath(import.meta.url)),
  rendererRoot = resolve(here, '../renderer')
app.setName('Lockbox Preview')
const ownsProfileLock =
  basename(app.getPath('exe')).toLowerCase() === 'lockboxsetup.exe' ||
  app.requestSingleInstanceLock()
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
})
const secretClipboard = new SecretClipboard(clipboard, 30000, () => {
  lastError = 'PROOF_CLIPBOARD_CLEAR_BLOCKED'
})
let liveRoundTripAt = null
let pendingBackup = null
let window,
  replica,
  googleSession,
  configuration = null,
  lastError = '',
  syncTimer,
  syncInterval
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
  if (
    !diagnostic &&
    !renderCheck &&
    basename(app.getPath('exe')).toLowerCase() === 'lockboxsetup.exe'
  ) {
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: 'Install Lockbox Preview',
      message: 'Install the local Windows preview for fictional data only?',
      detail:
        'Your existing vaults and databases will not be changed. Google connection is available only after developer registration. Choose how this computer will participate.',
      buttons: ['Install for household owner', 'Install for partner', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
    })
    if (choice.response === 2) {
      app.quit()
      return
    }
    try {
      const executable = installFiles(
        dirname(app.getPath('exe')),
        join(process.env.LOCALAPPDATA ?? app.getPath('appData'), 'Programs'),
      )
      const shortcutDir = join(
        app.getPath('appData'),
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
      )
      mkdirSync(shortcutDir, { recursive: true })
      const installRole = choice.response === 0 ? 'owner' : 'partner'
      check(
        shell.writeShortcutLink(
          join(shortcutDir, 'Lockbox Preview - ' + installRole + '.lnk'),
          'create',
          {
            target: executable,
            args: '--role=' + installRole + ' --profile=' + installRole,
            description:
              'Encrypted local Lockbox preview. Fictional data only.',
            cwd: dirname(executable),
          },
        ),
        'PROOF_INSTALL_SHORTCUT_FAILED',
      )
      check(
        shell.writeShortcutLink(
          join(
            shortcutDir,
            'Lockbox Google Drive test - ' + installRole + '.lnk',
          ),
          'create',
          {
            target: executable,
            args:
              '--google-test --role=' +
              installRole +
              ' --profile=' +
              installRole,
            description:
              'Isolated fictional Google Drive qualification. Not for existing vaults.',
            cwd: dirname(executable),
          },
        ),
        'PROOF_INSTALL_SHORTCUT_FAILED',
      )
      await dialog.showMessageBox({
        type: 'info',
        title: 'Lockbox Preview installed',
        message:
          'Installation complete. Open Lockbox Preview - ' +
          installRole +
          ' from the Windows Start menu.',
        detail:
          'The application works without Vercel or a Lockbox server. Use fictional data only until live Google and security validation are complete.',
      })
    } catch {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Installation stopped',
        message:
          'Lockbox could not verify or install this package. Existing data was not changed.',
      })
    }
    app.quit()
    return
  }
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
    assertCloudMode({ diagnostic, googleTest, configuration })
    check(googleSession?.connection, 'PROOF_GOOGLE_NOT_CONNECTED')
    return new NativeDrive(googleSession.connection)
  }
  replica = new Replica(store, role, drive, { cloudTest: googleTest })
  replica.onLocked = () => secretClipboard.clear()
  if (!diagnostic) {
    const configFile = join(here, '../public-config.json')
    try {
      if (existsSync(configFile))
        configuration = validateConfiguration(
          JSON.parse(readFileSync(configFile, 'utf8')),
        )
      if (configuration && googleTest) {
        assertCloudMode({ googleTest, configuration })
        googleSession = new GoogleSession(configuration, {
          read: () => ({
            google: replica.data.google,
            tokens: replica.data.tokens,
          }),
          write: (values) => {
            const previous = {
              google: replica.data.google,
              tokens: replica.data.tokens,
            }
            Object.assign(replica.data, values)
            try {
              replica.save()
            } catch (error) {
              Object.assign(replica.data, previous)
              throw error
            }
          },
        })
        googleSession.restore()
      }
    } catch (error) {
      googleSession = null
      lastError = code(error)
    }
  }
  const status = () => ({
    ...replica.status(),
    googleConfigured: diagnostic ? false : Boolean(configuration),
    googleTestMode: googleTest,
    liveSyncAllowed:
      diagnostic || Boolean(googleTest && configuration?.scope === FILE_SCOPE),
    securityBlockers: cloudBlockers,
    googleAuthorising: Boolean(googleSession?.authorising),
    lastError,
    simulated: diagnostic,
    googleConnected: diagnostic
      ? Boolean(replica.data.google)
      : Boolean(googleSession?.connected),
    scope: configuration?.scope ?? FILE_SCOPE,
  })
  async function sync() {
    try {
      await replica.sync()
      if (!diagnostic && googleTest) liveRoundTripAt = Date.now()
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
      if (googleSession?.connected && replica.data.folders) {
        if (replica.busy) schedule()
        else void sync().catch(() => {})
      }
    }, 750)
  }
  if (!diagnostic && !renderCheck) {
    syncInterval = setInterval(() => {
      if (googleSession?.connected && replica.data.folders && !replica.busy)
        void sync().catch(() => {})
    }, 60000)
    if (googleSession?.connected && replica.data.folders) schedule()
  }
  async function dispatch(action, payload) {
    check(JSON.stringify(payload ?? null).length < 2000000, 'PROOF_INPUT_LIMIT')
    if (action === 'renderer-ready') {
      if (renderCheck) {
        writeFileSync(
          join(directory, 'renderer-ready.json'),
          JSON.stringify({
            ready: true,
            backendUsed: false,
            googleTestMode: googleTest,
            googleConfigured: Boolean(configuration),
            liveSyncAllowed: Boolean(
              googleTest && configuration?.scope === FILE_SCOPE,
            ),
          }),
        )
        setTimeout(() => app.quit(), 100)
      }
      return true
    }
    if (action === 'clipboard-copy') {
      secretClipboard.copy(payload.value)
      return true
    }
    if (action === 'clipboard-clear') {
      secretClipboard.clear()
      return true
    }
    if (action === 'google-test-report') {
      return {
        format: 'lockbox-google-test-report-v1',
        generatedAt: new Date().toISOString(),
        simulated: diagnostic,
        isolatedFictionalProfile: googleTest,
        registrationInstalled: Boolean(configuration),
        requestedScope: configuration?.scope ?? FILE_SCOPE,
        connected: Boolean(googleSession?.connected),
        accountFingerprint: replica.data.google
          ? hash(replica.data.google.permissionId)
          : null,
        oauthVerifiedThisRun: Boolean(
          googleSession?.connected && googleSession.verifiedAt,
        ),
        realGoogleRoundTripThisRunAt: liveRoundTripAt,
        lastError: lastError || googleSession?.lastError || null,
        pendingChanges: replica.status().pendingChanges,
        personalConflicts: replica.data.conflicts.personal.length,
        householdConflicts: replica.data.conflicts.household.length,
        peerSharedCommitsObserved: replica.data.journal.household.filter(
          (packet) => packet.body.author.accountId !== replica.id,
        ).length,
        twoPhysicalComputersVerified: false,
        integrationComplete: false,
        securityBlockers: cloudBlockers,
      }
    }
    if (action === 'status') return status()
    if (action === 'choose-role') {
      check(
        !diagnostic &&
          !replica.data.state.profile &&
          ['owner', 'partner'].includes(payload.role),
        'PROOF_ROLE_CHANGE_NOT_AVAILABLE',
      )
      const temp = selectionPath + '.' + Date.now() + '.tmp'
      writeFileSync(temp, JSON.stringify({ role: payload.role }), {
        flag: 'wx',
        mode: 0o600,
      })
      renameSync(temp, selectionPath)
      app.relaunch({
        args: process.argv
          .slice(1)
          .filter(
            (a) => !a.startsWith('--role=') && !a.startsWith('--profile='),
          )
          .concat('--role=' + payload.role, '--profile=' + payload.role),
      })
      app.quit()
      return true
    }
    if (action === 'history') return replica.historyVersions(payload.scope)
    if (action === 'conflicts') return replica.conflictVersions(payload.scope)
    if (action === 'resolve-conflict') {
      const state = replica.resolveConflict(
        payload.scope,
        payload.selected,
        payload.expectedHeads,
      )
      schedule()
      return state
    }
    if (action === 'backup-export') {
      replica.requireIdentity()
      const backup = replica.exportBackup(payload.root)
      const selected = diagnostic
        ? { canceled: false, filePath: payload.file }
        : await dialog.showSaveDialog(window, {
            title: 'Save portable encrypted backup',
            defaultPath:
              'Lockbox-' +
              role +
              '-' +
              new Date().toISOString().replaceAll(':', '-') +
              '.lockbox-backup',
            filters: [
              {
                name: 'Encrypted Lockbox backup',
                extensions: ['lockbox-backup'],
              },
            ],
          })
      if (selected.canceled || !selected.filePath) return { saved: false }
      const file = backupDestination(
        selected.filePath,
        dirname(app.getPath('exe')),
      )
      if (diagnostic)
        check(
          file.startsWith(directory + sep),
          'PROOF_DIAGNOSTIC_ROOT_REQUIRED',
        )
      const fd = openSync(file, 'wx', 0o600)
      try {
        writeSync(fd, JSON.stringify(backup))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return { saved: true }
    }
    if (action === 'backup-inspect') {
      check(!replica.data.state.profile, 'PROOF_RESTORE_REQUIRES_EMPTY_PROFILE')
      pendingBackup = null
      const selected = diagnostic
        ? { canceled: false, filePaths: [payload.file] }
        : await dialog.showOpenDialog(window, {
            title: 'Open portable encrypted backup',
            properties: ['openFile'],
            filters: [
              {
                name: 'Encrypted Lockbox backup',
                extensions: ['lockbox-backup'],
              },
            ],
          })
      if (selected.canceled || !selected.filePaths[0]) return null
      const file = resolve(selected.filePaths[0])
      if (diagnostic)
        check(
          file.startsWith(directory + sep),
          'PROOF_DIAGNOSTIC_ROOT_REQUIRED',
        )
      const stat = lstatSync(file)
      check(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.size <= 24 * 1024 * 1024,
        'PROOF_BACKUP_INVALID',
      )
      const packet = JSON.parse(readFileSync(file, 'utf8'))
      const header = backupHeader(packet)
      check(header.role === role, 'PROOF_BACKUP_ROLE_MISMATCH')
      pendingBackup = packet
      return header
    }
    if (action === 'backup-restore') {
      check(pendingBackup, 'PROOF_BACKUP_REQUIRED')
      const result = replica.restoreBackup(
        pendingBackup,
        payload.root,
        payload.replacementProfile,
      )
      pendingBackup = null
      googleSession?.reset()
      return result
    }
    if (action === 'disconnect') {
      replica.requireIdentity()
      check(!replica.busy, 'PROOF_SYNC_BUSY')
      googleSession?.disconnect()
      clearTimeout(syncTimer)
      return status()
    }
    if (action === 'google-test-mode') {
      check(!diagnostic && !renderCheck && !replica.busy, 'PROOF_SYNC_BUSY')
      const choice = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Separate Google Drive test',
        message: googleTest
          ? 'Return to your local preview?'
          : 'Open an isolated fictional Google Drive test vault?',
        detail:
          'Existing vaults and recovery information stay in their original location. Google test vaults are separate and must contain fictional entries only. Device revocation and key rotation remain unfinished.',
        buttons: ['Cancel', 'Open separate profile'],
        defaultId: 0,
        cancelId: 0,
      })
      if (choice.response !== 1) return false
      const args = process.argv.slice(1).filter((a) => a !== '--google-test')
      if (!googleTest) args.push('--google-test')
      app.relaunch({ args })
      app.quit()
      return true
    }
    if (action === 'touch-identity') return replica.touchIdentity()
    if (action === 'lock-identity') {
      replica.lockIdentity()
      return true
    }
    if (action === 'unlock-identity')
      return replica.unlockIdentity(payload.root)
    if (action === 'api') {
      const result = replica.api(payload.path, payload.body, payload.setupRoot)
      if (payload.path !== 'state') schedule()
      return result
    }
    if (action === 'connect') {
      replica.requireIdentity()
      assertCloudMode({ diagnostic: false, googleTest, configuration })
      check(
        !diagnostic && googleSession,
        'PROOF_DEVELOPER_GOOGLE_CLIENT_REQUIRED',
      )
      check(!replica.busy, 'PROOF_SYNC_BUSY')
      await googleSession.connect(
        {
          open: (url) => shell.openExternal(url),
          pickFolders: replica.data.folders
            ? [replica.data.folders.personal, replica.data.folders.shared]
            : [],
        },
        () => replica.requireIdentity(),
      )
      schedule()
      return status()
    }
    if (
      [
        'create-folders',
        'pairing',
        'grant',
        'export-grant',
        'import-grant',
        'household-code',
        'sync',
      ].includes(action)
    )
      assertCloudMode({ diagnostic, googleTest, configuration })
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
      title: 'Lockbox Preview',
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
    window.webContents.on('render-process-gone', () => replica.lockIdentity())
    window.webContents.on(
      'did-start-navigation',
      (_event, _url, inPlace, isMainFrame) => {
        if (isMainFrame && !inPlace) replica.lockIdentity()
      },
    )
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
if (ownsProfileLock)
  void start().catch(() => {
    process.stderr.write('PROOF_STARTUP_FAILED\n')
    app.exit(1)
  })
else app.exit(0)
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  clearTimeout(syncTimer)
  clearInterval(syncInterval)
  replica?.lockIdentity()
  googleSession?.reset()
  secretClipboard.clear()
})
