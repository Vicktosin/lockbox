import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { LockKeyhole, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import { DemoWorkspace } from '@/app/App'
import { AuthApiError, type AccountSession } from '../auth/api'
import {
  VaultEngine,
  type SetupDraft,
  type RecoveryDraft,
  type VaultState,
  type VaultApi,
} from './engine'
import { destroyKeys } from './crypto'
import { createVaultApi } from './api'
import { IdleLock } from './idle-lock'
import { clearSecretClipboard } from '@/lib/secure-clipboard'
import { DriveSettings } from '../drive/drive-settings'
import { RecoveryPanel } from '../auth/recovery-panel'
import { BackupSettings } from '../settings/backup-settings'

type Draft =
  | { kind: 'setup'; value: SetupDraft }
  | { kind: 'recovery'; value: RecoveryDraft }
export function VaultGate({
  session,
  onLogout,
  onSignedOut,
  onExpired,
}: {
  session: AccountSession
  onLogout: () => void
  onSignedOut: () => void
  onExpired: () => void
}) {
  const api = useMemo<VaultApi>(() => {
    const request = createVaultApi(session.csrfToken)
    return async (path, body) => {
      try {
        return await request(path, body)
      } catch (error) {
        if (error instanceof AuthApiError && error.status === 401) onExpired()
        throw error
      }
    }
  }, [session.csrfToken, onExpired])
  const [state, setState] = useState<VaultState | null>(null),
    [engine, setEngine] = useState<VaultEngine | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [mode, setMode] = useState<'unlock' | 'recovery'>('unlock'),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [recovery, setRecovery] = useState(''),
    [code, setCode] = useState(''),
    [verification, setVerification] = useState(''),
    [notice, setNotice] = useState('')
  const live = useRef(true),
    generation = useRef(0),
    draft = useRef<Draft | null>(null),
    active = useRef<VaultEngine | null>(null)
  const [cloudVisible, setCloudVisible] = useState(false)
  const eraseDraft = useCallback(() => {
    if (draft.current) destroyKeys(draft.current.value.keys)
    draft.current = null
    setCode('')
    setVerification('')
    setPassword('')
    setConfirmation('')
    setRecovery('')
  }, [])
  const lock = useCallback(() => {
    generation.current++
    active.current?.lock()
    active.current = null
    setEngine(null)
    eraseDraft()
    setBusy(false)
    setError('')
    setNotice('Vault locked. Unlock with your master password.')
    void clearSecretClipboard()
  }, [eraseDraft])
  const load = useCallback(async () => {
    try {
      const value = await api('state')
      if (live.current) setState(value)
    } catch (reason) {
      if (reason instanceof AuthApiError && reason.status === 401) onExpired()
      else if (live.current)
        setError(
          'Unable to load the vault. Start the backend and check the connection.',
        )
    } finally {
      if (live.current) setLoading(false)
    }
  }, [api, onExpired])
  useEffect(() => {
    live.current = true
    const initial = setTimeout(() => void load(), 0)
    const lifecycle = generation
    return () => {
      clearTimeout(initial)
      live.current = false
      lifecycle.current++
      active.current?.lock()
      if (draft.current) destroyKeys(draft.current.value.keys)
      void clearSecretClipboard()
    }
  }, [load])
  useEffect(() => {
    const idle = new IdleLock(lock),
      touch = () => idle.touch(),
      check = () => idle.check()
    const hidden = () => {
      if (document.visibilityState === 'hidden' && draft.current) lock()
      else check()
    }
    const pagehide = () => lock()
    if (!engine && !code) return
    const timer = setInterval(check, 1000)
    for (const name of ['pointerdown', 'keydown', 'touchstart', 'wheel'])
      window.addEventListener(name, touch, { passive: true })
    window.addEventListener('focus', check)
    window.addEventListener('pagehide', pagehide)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      idle.stop()
      clearInterval(timer)
      for (const name of ['pointerdown', 'keydown', 'touchstart', 'wheel'])
        window.removeEventListener(name, touch)
      window.removeEventListener('focus', check)
      window.removeEventListener('pagehide', pagehide)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [engine, code, lock])
  async function run(operation: (attempt: number) => Promise<void>) {
    const attempt = generation.current
    setBusy(true)
    setError('')
    try {
      await operation(attempt)
    } catch (reason) {
      if (reason instanceof AuthApiError && reason.status === 401) onExpired()
      else if (live.current && attempt === generation.current)
        setError(
          reason instanceof Error ? reason.message : 'Vault operation failed.',
        )
    } finally {
      if (live.current && attempt === generation.current) setBusy(false)
    }
  }
  function accept(value: VaultEngine, attempt: number) {
    if (
      !live.current ||
      attempt !== generation.current ||
      document.visibilityState === 'hidden'
    ) {
      value.lock()
      return
    }
    draft.current = null
    setCode('')
    setVerification('')
    setPassword('')
    setConfirmation('')
    setRecovery('')
    active.current = value
    setEngine(value)
    setState(value.encryptedState)
    setNotice('')
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void run(async (attempt) => {
      if (code && draft.current) {
        const pending = draft.current
        const value =
          pending.kind === 'setup'
            ? await VaultEngine.finishSetup(
                api,
                session.user.id,
                pending.value,
                verification,
              )
            : await VaultEngine.finishRecovery(
                api,
                session.user.id,
                pending.value,
                verification,
              )
        accept(value, attempt)
        return
      }
      if (!state?.profile || mode === 'recovery') {
        const pending: Draft = !state?.profile
          ? {
              kind: 'setup',
              value: await VaultEngine.prepare(
                session.user.id,
                password,
                confirmation,
              ),
            }
          : {
              kind: 'recovery',
              value: await VaultEngine.prepareRecovery(
                api,
                session.user.id,
                recovery,
                password,
                confirmation,
              ),
            }
        if (
          !live.current ||
          attempt !== generation.current ||
          document.visibilityState === 'hidden'
        ) {
          destroyKeys(pending.value.keys)
          return
        }
        draft.current = pending
        setCode(pending.value.recoveryCode)
        setPassword('')
        setConfirmation('')
        setRecovery('')
        return
      }
      accept(await VaultEngine.unlock(api, session.user.id, password), attempt)
    })
  }
  if (engine)
    return (
      <DemoWorkspace
        key={session.user.id}
        accountSession={session}
        engine={engine}
        onLock={lock}
        onLogout={() => {
          lock()
          onLogout()
        }}
        onSignedOut={() => {
          lock()
          onSignedOut()
        }}
        onExpired={() => {
          lock()
          onExpired()
        }}
      />
    )
  return (
    <>
      <main className="auth-page vault-access">
        <section className="auth-intro">
          <span className="brand-mark">
            <LockKeyhole />
          </span>
          <span className="eyebrow">SIGNED IN AS {session.user.username}</span>
          <h1>
            {state?.profile
              ? 'Your vault.\nYour key.'
              : 'Make this vault yours.'}
          </h1>
          <p>
            Your master password stays on this device. Encrypted vault data is
            saved to your local Lockbox backend.
          </p>
          <p className="field-hint">
            Independent security review is still required before relying on this
            build for important secrets.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              lock()
              onLogout()
            }}
          >
            <LogOut />
            Sign out
          </Button>
        </section>
        <section className="panel auth-form-panel">
          <h2>
            {loading
              ? 'Loading vault…'
              : code
                ? 'Save your recovery key'
                : !state?.profile
                  ? 'Create a master password'
                  : mode === 'recovery'
                    ? 'Recover your vault'
                    : 'Unlock your vault'}
          </h2>
          {notice && <p role="status">{notice}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!state && !loading ? (
            <Button onClick={() => void load()}>Retry vault connection</Button>
          ) : (
            !loading && (
              <form onSubmit={submit} autoComplete="off">
                {code ? (
                  <>
                    <p>
                      Store this key somewhere private, separate from Lockbox.
                      It can unlock your vault without the master password. It
                      does not recover account login.
                    </p>
                    <textarea
                      aria-label="New recovery key"
                      className="form-input recovery-key"
                      readOnly
                      value={code}
                    />
                    <CopyButton
                      value={code}
                      label="Copy recovery key"
                      showLabel
                      onError={setError}
                    />
                    <Field
                      label="Re-enter the complete recovery key"
                      htmlFor="vault-verification"
                      hint="The vault is not saved until this key is verified."
                    >
                      <Input
                        id="vault-verification"
                        disabled={busy}
                        value={verification}
                        onChange={(e) => setVerification(e.target.value)}
                        required
                        autoComplete="off"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    {mode === 'recovery' && state?.profile && (
                      <Field label="Recovery key" htmlFor="vault-recovery">
                        <Input
                          id="vault-recovery"
                          disabled={busy}
                          value={recovery}
                          onChange={(e) => setRecovery(e.target.value)}
                          required
                          autoComplete="off"
                        />
                      </Field>
                    )}
                    <Field
                      label={
                        !state?.profile || mode === 'recovery'
                          ? 'New master password'
                          : 'Master password'
                      }
                      htmlFor="vault-master"
                      hint="Use a different passphrase from your login password. At least 15 characters."
                    >
                      <Input
                        id="vault-master"
                        disabled={busy}
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={15}
                        maxLength={256}
                        autoComplete={
                          state?.profile && mode === 'unlock'
                            ? 'off'
                            : 'new-password'
                        }
                      />
                    </Field>
                    {(!state?.profile || mode === 'recovery') && (
                      <Field
                        label="Confirm master password"
                        htmlFor="vault-confirmation"
                      >
                        <Input
                          id="vault-confirmation"
                          disabled={busy}
                          type="password"
                          value={confirmation}
                          onChange={(e) => setConfirmation(e.target.value)}
                          required
                          minLength={15}
                          maxLength={256}
                          autoComplete="new-password"
                        />
                      </Field>
                    )}
                  </>
                )}
                <Button type="submit" disabled={busy}>
                  {busy
                    ? 'Working…'
                    : code
                      ? 'Verify key and open vault'
                      : !state?.profile
                        ? 'Create vault keys'
                        : mode === 'recovery'
                          ? 'Recover and replace master password'
                          : 'Unlock vault'}
                </Button>
                {code ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={eraseDraft}
                  >
                    Cancel
                  </Button>
                ) : (
                  state?.profile && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        eraseDraft()
                        setError('')
                        setMode(mode === 'unlock' ? 'recovery' : 'unlock')
                      }}
                    >
                      {mode === 'unlock'
                        ? 'Use a recovery key'
                        : 'Back to master password'}
                    </Button>
                  )
                )}
              </form>
            )
          )}
        </section>
      </main>
      <div className="locked-cloud-settings">
        <Button
          variant="outline"
          onClick={() => setCloudVisible((value) => !value)}
        >
          {cloudVisible
            ? 'Hide account and cloud settings'
            : 'Account recovery and Google Drive settings'}
        </Button>
        {cloudVisible && (
          <>
            <RecoveryPanel session={session} />
            {session.user.role === 'administrator' && (
              <BackupSettings session={session} />
            )}
            <DriveSettings session={session} onExpired={onExpired} />
          </>
        )}
      </div>
    </>
  )
}
