import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import '../../../src/index.css'
import { AppShell } from '@/components/layout/app-shell'
import { Dashboard } from '@/features/dashboard/dashboard'
import { CredentialLibrary } from '@/features/credentials/credential-library'
import {
  CredentialDetails,
  CredentialForm,
  DeleteCredential,
} from '@/features/credentials/credential-dialogs'
import { PasswordGenerator } from '@/features/generator/password-generator'
import {
  generatePassword,
  defaultOptions,
} from '@/features/generator/generate-password'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import type {
  Credential,
  CredentialDraft,
  Page,
} from '@/features/credentials/types'
import { VaultEngine, type VaultApi } from '@/features/vault/engine'
import { destroyKeys } from '@/features/vault/crypto'
import { clearSecretClipboard } from '@/lib/secure-clipboard'
import { IdleLock } from '@/features/vault/idle-lock'
import type { VaultState } from '../../../shared/client-vault'

type Prepared =
  | Awaited<ReturnType<typeof VaultEngine.prepare>>
  | Awaited<ReturnType<typeof VaultEngine.prepareRecovery>>
type Status = {
  role: 'owner' | 'partner'
  accountId: string
  fingerprint: string
  google: { emailAddress: string } | null
  googleConfigured: boolean
  configuredFolders: boolean
  householdApproved: boolean
  lastSync: number | null
  lastError: string
  conflicts: { personal: string[]; household: string[] }
}
declare global {
  interface Window {
    lockboxProof: {
      request: <T = unknown>(action: string, payload?: unknown) => Promise<T>
    }
  }
}
const request = <T,>(action: string, payload?: unknown) =>
  window.lockboxProof.request<T>(action, payload)
const api: VaultApi = (path, body) =>
  request<VaultState>('api', { path, ...(body === undefined ? {} : { body }) })
const messages: Record<string, string> = {
  PROOF_DEVELOPER_GOOGLE_CLIENT_REQUIRED:
    'The developer must configure the registered Desktop OAuth client. You do not need Google Cloud Console.',
  PROOF_GOOGLE_FOLDER_PERMISSION_REQUIRED:
    'Google has not authorized these proof folders. Authorize the shared folders, then retry.',
  PROOF_NETWORK_UNAVAILABLE: 'Offline. Local encrypted changes are retained.',
  PROOF_SYNC_CONFLICT:
    'Conflicting encrypted branches are retained. This limited proof does not resolve them.',
  PROOF_SYNC_BUSY:
    'Drive synchronization is active. Retry your change after it finishes.',
}
export function Proof() {
  const [status, setStatus] = useState<Status | null>(null),
    [stored, setStored] = useState<VaultState | null>(null),
    [engine, setEngine] = useState<VaultEngine | null>(null),
    [page, setPage] = useState<Page>('dashboard'),
    [credentials, setCredentials] = useState<Credential[]>([]),
    [sidebar, setSidebar] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [recovery, setRecovery] = useState(''),
    [draft, setDraft] = useState<Prepared | null>(null),
    [pairing, setPairing] = useState(''),
    [packet, setPacket] = useState(''),
    [fingerprint, setFingerprint] = useState(''),
    [grant, setGrant] = useState(''),
    [selected, setSelected] = useState<Credential | null>(null),
    [dialog, setDialog] = useState<'view' | 'edit' | 'delete' | null>(null)
  const active = useRef<VaultEngine | null>(null),
    pending = useRef<typeof draft>(null)
  const refresh = useCallback(async () => {
    setStatus(await request<Status>('status'))
    setStored(await api('state'))
    await request('renderer-ready')
  }, [])
  const lock = useCallback(() => {
    active.current?.lock()
    active.current = null
    if (pending.current) destroyKeys(pending.current.keys)
    pending.current = null
    setEngine(null)
    setDraft(null)
    setCredentials([])
    setSelected(null)
    setDialog(null)
    setPassword('')
    setConfirmation('')
    setRecovery('')
    setGrant('')
    void clearSecretClipboard()
  }, [])
  useEffect(() => {
    let alive = true
    void Promise.resolve()
      .then(() => {
        if (alive) return refresh()
      })
      .catch(() => {
        if (alive) setNotice('The native proof could not open safely.')
      })
    return () => {
      alive = false
      active.current?.lock()
      if (pending.current) destroyKeys(pending.current.keys)
    }
  }, [refresh])
  useEffect(() => {
    const interval = setInterval(
      () =>
        void request<Status>('status')
          .then(setStatus)
          .catch(() => {}),
      5000,
    )
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    if (!engine && !draft) return
    const idle = new IdleLock(lock),
      touch = () => idle.touch(),
      check = () => idle.check()
    const interval = setInterval(check, 1000)
    for (const name of ['pointerdown', 'keydown', 'wheel'])
      window.addEventListener(name, touch, { passive: true })
    window.addEventListener('focus', check)
    window.addEventListener('pagehide', lock)
    document.addEventListener('visibilitychange', check)
    return () => {
      idle.stop()
      clearInterval(interval)
      for (const name of ['pointerdown', 'keydown', 'wheel'])
        window.removeEventListener(name, touch)
      window.removeEventListener('focus', check)
      window.removeEventListener('pagehide', lock)
      document.removeEventListener('visibilitychange', check)
    }
  }, [engine, draft, lock])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setNotice('')
    try {
      await action()
      if (active.current && !active.current.locked)
        setCredentials(active.current.credentials)
      await refresh()
    } catch (error) {
      if (active.current?.locked) lock()
      const message =
        error instanceof Error ? error.message : 'Proof operation failed.'
      setNotice(messages[message] ?? message)
    } finally {
      setBusy(false)
    }
  }
  function install(value: VaultEngine) {
    active.current = value
    setEngine(value)
    setCredentials(value.credentials)
  }
  const user = status?.role === 'partner' ? 'partner' : 'emmanuel'
  function add() {
    void run(async () => {
      if (!active.current) throw new Error('Unlock the proof vault first.')
      await active.current.saveCredential({
        name: 'Fictional ' + new Date().toISOString(),
        url: 'https://service.example.invalid',
        username: 'fictional@example.invalid',
        password: 'Fictional-' + generatePassword(defaultOptions),
        notes: 'Fictional native feasibility proof only.',
        category: 'Personal',
        vault: page === 'shared' ? 'shared' : 'personal',
        owner: user,
      })
    })
  }
  function save(value: CredentialDraft) {
    void run(async () => {
      if (
        !value.name.startsWith('Fictional ') ||
        !new URL(value.url).hostname.endsWith('.invalid') ||
        !value.username.endsWith('@example.invalid') ||
        !value.password.startsWith('Fictional-')
      )
        throw new Error(
          'Only fictional entries are allowed: name starts Fictional, URL ends .invalid, username ends @example.invalid and password starts Fictional-.',
        )
      await active.current!.saveCredential(value, selected!.id)
      setDialog(null)
    })
  }
  if (!status || !stored)
    return (
      <main className="auth-loading">Opening isolated fictional proof…</main>
    )
  if (!engine)
    return (
      <main className="auth-page">
        <section className="panel auth-form-panel">
          <h1>Lockbox desktop proof</h1>
          <p>
            Fictional data only · independent {status.role} installation · no
            Fastify account service
          </p>
          <p role="status">{notice}</p>
          {draft ? (
            <>
              <h2>Save and verify this test recovery key</h2>
              <textarea
                className="form-input recovery-key"
                aria-label="Fictional proof recovery key"
                readOnly
                value={draft.recoveryCode}
              />
              <CopyButton
                onError={setNotice}
                value={draft.recoveryCode}
                label="Copy test recovery key"
              />
              <Field
                label="Enter the complete recovery key to confirm"
                htmlFor="proof-recovery"
              >
                <Input
                  id="proof-recovery"
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                />
              </Field>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const value =
                      'state' in draft
                        ? await VaultEngine.finishRecovery(
                            api,
                            status.accountId,
                            draft,
                            recovery,
                          )
                        : await VaultEngine.finishSetup(
                            api,
                            status.accountId,
                            draft,
                            recovery,
                          )
                    pending.current = null
                    setDraft(null)
                    setRecovery('')
                    install(value)
                  })
                }
              >
                Confirm recovery and create test vault
              </Button>
            </>
          ) : (
            <>
              <h2>
                {stored.profile
                  ? 'Unlock test vault'
                  : 'Create test master password'}
              </h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(async () => {
                    if (stored.profile)
                      install(
                        await VaultEngine.unlock(
                          api,
                          status.accountId,
                          password,
                        ),
                      )
                    else {
                      const value = await VaultEngine.prepare(
                        status.accountId,
                        password,
                        confirmation,
                      )
                      pending.current = value
                      setDraft(value)
                    }
                    setPassword('')
                    setConfirmation('')
                  })
                }}
              >
                <Field label="Test master password" htmlFor="proof-master">
                  <Input
                    id="proof-master"
                    type="password"
                    autoComplete={
                      stored.profile ? 'current-password' : 'new-password'
                    }
                    required
                    minLength={15}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                {
                  <Field
                    label="Confirm test master password (required for setup or recovery)"
                    htmlFor="proof-confirm"
                  >
                    <Input
                      id="proof-confirm"
                      type="password"
                      autoComplete="new-password"
                      required={!stored.profile}
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                    />
                  </Field>
                }
                <Button disabled={busy}>
                  {stored.profile
                    ? 'Unlock'
                    : 'Prepare test recovery information'}
                </Button>
              </form>
              {stored.profile && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void run(async () => {
                      const value = await VaultEngine.prepareRecovery(
                        api,
                        status.accountId,
                        recovery,
                        password,
                        confirmation,
                      )
                      pending.current = value
                      setDraft(value)
                      setPassword('')
                      setConfirmation('')
                      setRecovery('')
                    })
                  }}
                >
                  <p>
                    For a forgotten master password, enter the existing vault
                    recovery key and the new password/confirmation above. Verify
                    the replacement recovery key before completing recovery.
                  </p>
                  <Input
                    aria-label="Existing test recovery key"
                    type="password"
                    value={recovery}
                    onChange={(e) => setRecovery(e.target.value)}
                  />
                  <Button variant="outline" disabled={busy}>
                    Prepare recovery
                  </Button>
                </form>
              )}
            </>
          )}
        </section>
      </main>
    )
  return (
    <AppShell
      page={page}
      navigate={setPage}
      credentials={credentials}
      user={user}
      account={{
        id: status.accountId,
        username:
          status.role === 'owner' ? 'FictionalOwner' : 'FictionalPartner',
        role: status.role === 'owner' ? 'administrator' : 'member',
      }}
      sidebarOpen={sidebar}
      setSidebarOpen={setSidebar}
      vaultActive
      onLock={lock}
    >
      <div className="panel settings-panel">
        <div className="settings-body">
          <strong>
            FICTIONAL NATIVE PROOF · no migration · no production credentials
          </strong>
          <p>
            Google: {status.google?.emailAddress ?? 'not connected'} ·{' '}
            {status.googleConfigured
              ? 'developer client configured'
              : 'developer registration missing'}{' '}
            · Last verified Drive round trip:{' '}
            {status.lastSync
              ? new Date(status.lastSync).toLocaleString()
              : 'never'}
          </p>
          {(status.conflicts.personal.length > 0 ||
            status.conflicts.household.length > 0) && (
            <p role="alert">
              Conflict detected. Both encrypted branches are retained.
              Destructive resolution is outside this proof.
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {status.lastError && (
            <p role="alert">{messages[status.lastError] ?? status.lastError}</p>
          )}
          <Button
            disabled={busy || !status.googleConfigured}
            onClick={() =>
              void run(async () => {
                await request('connect')
              })
            }
          >
            {status.google
              ? 'Authorize shared proof folders'
              : 'Connect my Google account'}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !status.google || !status.configuredFolders}
            onClick={() =>
              void run(async () => {
                await request('sync')
                await engine.refresh()
              })
            }
          >
            Sync Now
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => engine.refresh())}
          >
            Refresh local vault
          </Button>
          <Button variant="ghost" onClick={() => setPage('settings')}>
            Proof setup and pairing
          </Button>
        </div>
      </div>
      {page === 'dashboard' && (
        <Dashboard
          credentials={credentials}
          user={user}
          displayName={
            status.role === 'owner' ? 'FictionalOwner' : 'FictionalPartner'
          }
          navigate={setPage}
          onAdd={add}
          onSelect={(item) => {
            setSelected(item)
            setDialog('view')
          }}
          vaultActive
        />
      )}
      {['library', 'personal', 'shared'].includes(page) && (
        <CredentialLibrary
          page={page}
          credentials={credentials}
          onSelect={(item) => {
            setSelected(item)
            setDialog('view')
          }}
          onAdd={add}
          vaultActive
        />
      )}
      {page === 'generator' && (
        <PasswordGenerator
          notify={setNotice}
          onUse={() =>
            setNotice(
              'Use Add fictional credential; this proof does not save real website passwords.',
            )
          }
        />
      )}
      {page === 'settings' && (
        <section className="panel settings-panel">
          <div className="settings-body">
            <h2>Independent test installation</h2>
            <p>Account ID: {status.accountId}</p>
            <p>
              Compare this public identity fingerprint directly with the other
              participant before approving a grant:
            </p>
            <code>{status.fingerprint}</code>
            <Button
              disabled={busy || !status.google}
              onClick={() =>
                void run(async () =>
                  setPairing(JSON.stringify(await request('pairing'))),
                )
              }
            >
              Show my public pairing request
            </Button>
            <textarea
              className="form-input"
              aria-label="Public pairing request"
              readOnly
              value={pairing}
            />
            {pairing && (
              <CopyButton
                onError={setNotice}
                value={pairing}
                label="Copy public pairing request"
              />
            )}
            {status.role === 'owner' ? (
              <>
                <h3>Owner test setup</h3>
                <Button
                  disabled={busy || !status.google || status.configuredFolders}
                  onClick={() =>
                    void run(async () => {
                      await request('create-folders')
                    })
                  }
                >
                  Create new fictional Drive folders
                </Button>
                <Button
                  disabled={
                    busy ||
                    !status.configuredFolders ||
                    Boolean(engine.household)
                  }
                  onClick={() => void run(() => engine.createHousehold())}
                >
                  Create encrypted test Household
                </Button>
                <Field
                  label="Partner public pairing request"
                  htmlFor="proof-packet"
                >
                  <textarea
                    id="proof-packet"
                    className="form-input"
                    value={packet}
                    onChange={(e) => setPacket(e.target.value)}
                  />
                </Field>
                <Field
                  label="Partner fingerprint verified independently"
                  htmlFor="proof-fingerprint"
                >
                  <Input
                    id="proof-fingerprint"
                    value={fingerprint}
                    onChange={(e) => setFingerprint(e.target.value)}
                  />
                </Field>
                <Button
                  disabled={
                    busy ||
                    !engine.household?.joined ||
                    status.householdApproved
                  }
                  onClick={() =>
                    void run(async () => {
                      const value = await request('grant', {
                        pairing: JSON.parse(packet),
                        fingerprint: fingerprint.trim(),
                        householdCode: engine.exportHousehold(),
                      })
                      setGrant(JSON.stringify(value))
                    })
                  }
                >
                  Explicitly grant partner Household access
                </Button>
                {status.householdApproved && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void run(async () =>
                        setGrant(JSON.stringify(await request('export-grant'))),
                      )
                    }
                  >
                    Show existing encrypted grant
                  </Button>
                )}
                {grant && (
                  <>
                    <textarea
                      className="form-input"
                      readOnly
                      aria-label="Encrypted Household grant"
                      value={grant}
                    />
                    <CopyButton
                      onError={setNotice}
                      value={grant}
                      label="Copy encrypted grant"
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <h3>Accept an explicitly approved Household grant</h3>
                <Field label="Owner encrypted grant" htmlFor="proof-packet">
                  <textarea
                    id="proof-packet"
                    className="form-input"
                    value={packet}
                    onChange={(e) => setPacket(e.target.value)}
                  />
                </Field>
                <Field
                  label="Owner fingerprint verified independently"
                  htmlFor="proof-fingerprint"
                >
                  <Input
                    id="proof-fingerprint"
                    value={fingerprint}
                    onChange={(e) => setFingerprint(e.target.value)}
                  />
                </Field>
                <Button
                  disabled={busy || status.householdApproved}
                  onClick={() =>
                    void run(async () => {
                      await request('import-grant', {
                        packet: JSON.parse(packet),
                        fingerprint: fingerprint.trim(),
                      })
                    })
                  }
                >
                  Accept signed grant
                </Button>
                <p>
                  After acceptance, authorize these shared proof folders with
                  Google, then Sync Now.
                </p>
                <Button
                  disabled={
                    busy ||
                    !status.householdApproved ||
                    !engine.household ||
                    engine.household.joined
                  }
                  onClick={() =>
                    void run(async () => {
                      const code = await request<string>('household-code')
                      await engine.joinHousehold(code)
                    })
                  }
                >
                  Unlock approved Household with my own master-protected keyring
                </Button>
              </>
            )}
            <p>
              This limited proof has no native login-password layer, final
              device-revocation protocol or safe conflict-resolution interface.
              It is not a production application.
            </p>
          </div>
        </section>
      )}
      {selected && dialog === 'view' && (
        <CredentialDetails
          credential={selected}
          persisted
          onClose={() => setDialog(null)}
          onEdit={() => setDialog('edit')}
          onDelete={() => setDialog('delete')}
          notify={setNotice}
        />
      )}
      {selected && dialog === 'edit' && (
        <CredentialForm
          credential={selected}
          user={user}
          onClose={() => setDialog(null)}
          onSave={save}
          persisted
          busy={busy}
          sharedAvailable={Boolean(engine.household?.joined)}
        />
      )}
      {selected && dialog === 'delete' && (
        <DeleteCredential
          credential={selected}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void run(async () => {
              await engine.deleteCredential(selected.id)
              setDialog(null)
            })
          }
          persisted
          busy={busy}
        />
      )}
    </AppShell>
  )
}
createRoot(document.getElementById('root')!).render(<Proof />)
