// Developer diagnostic module, not the Lockbox UI. Uses real browser workers, cookies and APIs.
import { VaultEngine } from '../../src/features/vault/engine.ts'
import {
  generatePassword,
  defaultOptions,
} from '../../src/features/generator/generate-password.ts'
const params = new URL(globalThis.location.href).searchParams,
  role = params.get('role'),
  phase = params.get('phase'),
  cap = globalThis.location.hash.slice(1)
globalThis.history.replaceState(
  null,
  '',
  globalThis.location.pathname + globalThis.location.search,
)
const checks = []
let step = 'initialise',
  csrf = '',
  engine,
  workerCount = 0
const NativeWorker = globalThis.Worker
globalThis.Worker = new Proxy(NativeWorker, {
  construct(target, args) {
    workerCount++
    return Reflect.construct(target, args)
  },
})
const loginPassword = 'Fictional browser login ' + role + ' passphrase!',
  changedLogin = loginPassword + ' renewed',
  master = 'Fictional independent browser master ' + role + '!',
  changedMaster = master + ' renewed'
let currentMaster = phase === 'reopen' ? changedMaster : master
function check(value, label) {
  if (!value) throw new Error(label)
  checks.push(label)
}
async function broker(path, body) {
  const r = await fetch('/__runtime/' + path + '?role=' + role, {
    method: body ? 'POST' : 'GET',
    headers: {
      'X-Runtime-Capability': cap,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error('diagnostic coordination failed')
  return r.json()
}
async function until(test) {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    const state = await broker('state')
    if (test(state)) return state
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('diagnostic peer timeout')
}
async function api(path, body, expect = 200) {
  const r = await fetch('/api/' + path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'X-Runtime-Client': role,
      ...(body
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (r.status !== expect)
    throw new Error('unexpected API status for ' + path + ': ' + r.status)
  if (r.status === 204) return null
  return r.json()
}
const vaultApi = async (path, body) => api('vault/' + path, body)
const draft = (name, vault = 'personal') => ({
  name,
  url: 'https://example.test',
  username: 'fictional-browser-user',
  password: 'FICTIONAL-BROWSER-SAVED-' + name,
  notes: 'synthetic diagnostic only',
  category: 'Personal',
  vault,
  owner: role === 'administrator' ? 'emmanuel' : 'partner',
})
async function login(password) {
  const session = await api('auth/login', {
    username: role === 'administrator' ? 'BrowserAdmin' : 'BrowserPartner',
    password,
  })
  csrf = session.csrfToken
  return session
}
async function run() {
  const config = await broker('config')
  check(globalThis.isSecureContext, 'loopback secure context')
  if (phase === 'initial') {
    step = 'registration'
    const invite =
      role === 'administrator'
        ? config.invite
        : (await until((s) => s.invite)).invite
    await api(
      'auth/register',
      {
        username: role === 'administrator' ? 'BrowserAdmin' : 'BrowserPartner',
        password: loginPassword,
        passwordConfirmation: loginPassword,
        inviteCode: invite,
      },
      201,
    )
    const session = await login(loginPassword)
    check(
      !globalThis.document.cookie.includes('lockbox_'),
      'HttpOnly session is not script-readable',
    )
    step = 'worker master setup'
    const prepared = await VaultEngine.prepare(session.user.id, master, master)
    let recovery = prepared.recoveryCode
    engine = await VaultEngine.finishSetup(
      vaultApi,
      session.user.id,
      prepared,
      recovery,
    )
    check(workerCount > 0, 'real Argon2 worker used')
    await engine.saveCredential(draft(role + '-private'))
    const item = engine.credentials.find((x) => x.name === role + '-private')
    await engine.saveCredential(
      {
        ...draft(role + '-private-edited'),
        password: 'FICTIONAL-BROWSER-EDITED-' + role,
      },
      item.id,
    )
    await engine.saveCredential(draft(role + '-delete'))
    await engine.deleteCredential(
      engine.credentials.find((x) => x.name === role + '-delete').id,
    )
    await engine.saveFolder('Browser folder ' + role, 'personal')
    check(
      !engine.credentials.some((x) => x.name === role + '-delete'),
      'credential deletion persists',
    )
    check(
      engine.credentials.some((x) => x.name === role + '-private-edited'),
      'credential edit persists',
    )
    if (role === 'administrator') {
      const invitation = await api('auth/invitations', {
        password: loginPassword,
      })
      await broker('state', { invite: invitation.inviteCode })
      const peer = await until((s) => s.memberId)
      await engine.createHousehold()
      await engine.grantHousehold(peer.memberId)
      await engine.saveCredential(draft('household-initial', 'shared'))
      // Controller transfers this synthetic sharing card out-of-band, never through HTTP/backend.
      globalThis.__runtimeTransfer = engine.exportHousehold()
      await until((s) => s.memberJoined)
    } else {
      await broker('state', { memberId: session.user.id })
      const deadline = Date.now() + 120000
      while (!globalThis.__runtimeHouseholdKey && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100))
      if (!globalThis.__runtimeHouseholdKey)
        throw new Error('out-of-band fixture transfer timed out')
      await engine.refresh()
      await engine.joinHousehold(globalThis.__runtimeHouseholdKey)
      globalThis.__runtimeHouseholdKey = null
      check(
        engine.credentials.some((x) => x.name === 'household-initial'),
        'explicit Household grant and transferred key work',
      )
      await broker('state', { memberJoined: true })
    }
    step = 'concurrent Household saves'
    await engine.refresh()
    await broker('state', { [role + 'Ready']: true })
    await until((s) => s.administratorReady && s.memberReady)
    let conflict = false
    try {
      await engine.saveCredential(draft(role + '-shared', 'shared'))
    } catch {
      conflict = true
    }
    await broker('state', {
      [role + 'Attempted']: true,
      [role + 'Conflict']: conflict,
    })
    await until((s) => s.administratorAttempted && s.memberAttempted)
    if (conflict) {
      await engine.refresh()
      await engine.saveCredential(draft(role + '-shared', 'shared'))
    }
    await broker('state', { [role + 'Saved']: true })
    await until((s) => s.administratorSaved && s.memberSaved)
    await engine.refresh()
    check(
      engine.credentials.some((x) => x.name === 'administrator-shared') &&
        engine.credentials.some((x) => x.name === 'member-shared'),
      'concurrent updates preserve both writers',
    )
    check(
      !engine.credentials.some(
        (x) =>
          x.name ===
          (role === 'administrator' ? 'member' : 'administrator') +
            '-private-edited',
      ),
      'other Personal vault remains isolated',
    )
    const scoped = await api(
      'vault/state?userId=' + (await broker('config')).otherId,
    )
    check(
      scoped.personal.ownerId === session.user.id,
      'server ignores attempted cross-account selection',
    )
    step = 'network interruption'
    await broker('drop', {})
    let failed = false
    try {
      await engine.saveCredential(draft(role + '-offline-save'))
    } catch {
      failed = true
    }
    check(failed, 'real dropped transport rejects save')
    await broker('online', {})
    await engine.refresh()
    check(
      !engine.credentials.some((x) => x.name === role + '-offline-save'),
      'failed network save does not replace ciphertext',
    )
    const generated = generatePassword({ ...defaultOptions, length: 32 })
    check(
      generated.length === 32 &&
        /[A-Z]/.test(generated) &&
        /[a-z]/.test(generated) &&
        /[0-9]/.test(generated),
      'secure browser generator works',
    )
    step = 'local recovery'
    engine.lock()
    let wrong = false
    try {
      await VaultEngine.unlock(
        vaultApi,
        session.user.id,
        'Wrong fictional browser master!',
      )
    } catch {
      wrong = true
    }
    check(wrong, 'incorrect master rejected')
    const recovered = await VaultEngine.prepareRecovery(
      vaultApi,
      session.user.id,
      recovery,
      changedMaster,
      changedMaster,
    )
    recovery = recovered.recoveryCode
    engine = await VaultEngine.finishRecovery(
      vaultApi,
      session.user.id,
      recovered,
      recovery,
    )
    currentMaster = changedMaster
    check(
      engine.credentials.some((x) => x.name === 'household-initial'),
      'master recovery preserves Household and Personal keyring',
    )
    engine.lock()
    check(engine.locked, 'manual lock discards active keys')
    step = 'login recovery'
    const code = (await api('auth/recovery-code', { password: loginPassword }))
      .code
    await api(
      'auth/recover',
      {
        username: session.user.username,
        code,
        password: changedLogin,
        passwordConfirmation: changedLogin,
      },
      204,
    )
    const replacement = await login(changedLogin)
    engine = await VaultEngine.unlock(
      vaultApi,
      replacement.user.id,
      currentMaster,
    )
    await api('auth/recovery-code', { password: changedLogin })
    check(
      engine.credentials.some((x) => x.name === role + '-private-edited'),
      'login reset preserves decryptable Personal data',
    )
    const cloud = await api('drive/status')
    check(
      cloud.configured === false && !cloud.connected,
      'missing real Google registration never claims connection',
    )
    if (role === 'administrator') {
      const status = await api('maintenance/status')
      check(
        status.offdevice.configured === false,
        'backup status truthfully reports no remote protection',
      )
    } else await api('maintenance/status', null, 403)
    check(
      globalThis.localStorage.length === 0 &&
        globalThis.sessionStorage.length === 0,
      'no plaintext or keys in persistent browser stores',
    )
  } else {
    step = 'persistent session reopening'
    const session = await api('auth/me')
    csrf = session.csrfToken
    check(
      !!session.user.id,
      'browser cookie survives graceful closure and reopening',
    )
    engine = await VaultEngine.unlock(vaultApi, session.user.id, changedMaster)
    check(
      engine.credentials.some((x) => x.name === role + '-private-edited'),
      'reopened browser decrypts persisted Personal vault',
    )
    check(
      engine.credentials.filter((x) => x.vault === 'shared').length === 3,
      'reopened browser retains Household writes',
    )
    await broker('state', { [role + 'Reopened']: true })
    await until((s) => s.expire)
    await api('auth/me', null, 401)
    check(true, 'server session expiration rejects persisted cookie')
    await login(changedLogin)
    await api('auth/logout', {}, 204)
    await api('auth/me', null, 401)
    check(true, 'logout revokes browser session')
  }
  engine?.lock()
  await broker('result', {
    ok: true,
    phase,
    checks,
    workerCount,
    userAgent: globalThis.navigator.userAgent,
  })
  globalThis.document.body.textContent = 'Runtime diagnostic completed.'
}
run().catch(async () => {
  engine?.lock()
  await broker('result', {
    ok: false,
    phase,
    failedStep: step,
    checks,
    workerCount,
    userAgent: globalThis.navigator.userAgent,
  })
  globalThis.document.body.textContent = 'Runtime diagnostic failed.'
})
