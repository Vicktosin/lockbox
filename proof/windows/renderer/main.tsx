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
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import type { Credential, CredentialDraft } from '@/features/credentials/types'
import { VaultEngine } from '@/features/vault/engine'
import { destroyKeys, unlockProfile, toBase64 } from '@/features/vault/crypto'
import {
  clearSecretClipboard,
  configureSecureClipboard,
} from '@/lib/secure-clipboard'
import { useNavigation } from '@/hooks/use-navigation'
import { IdleLock } from '@/features/vault/idle-lock'
import type { VaultState } from '../../../shared/client-vault'
import { VaultFolders } from '@/features/vault/folders'
import {
  api,
  request,
  nativeErrorMessage,
  type NativeStatus as Status,
} from './native-api'
import { BackupRestore } from './backup-restore'
import { DesktopSecurity } from './desktop-security'
import { ConflictReview } from './conflict-review'
import { DriveTestMode } from './drive-test-mode'

configureSecureClipboard({
  write: async (value) => {
    await request('clipboard-copy', { value })
  },
  clear: async () => {
    await request('clipboard-clear')
  },
})

type Prepared =
  | Awaited<ReturnType<typeof VaultEngine.prepare>>
  | Awaited<ReturnType<typeof VaultEngine.prepareRecovery>>
const messages: Record<string, string> = {
  PROOF_CLIPBOARD_CLEAR_BLOCKED:
    'Clipboard clearing was blocked. Clear it manually. Clipboard history can retain copied values.',
  PROOF_GOOGLE_SCOPE_MISMATCH:
    'Google permissions do not match this installation. Reconnect using the configured narrow permission.',
  PROOF_BACKUP_ROLE_MISMATCH:
    'This backup belongs to the other household role. Select the matching owner or partner installation before restoring.',
  PROOF_RESTORE_REQUIRES_EMPTY_PROFILE:
    'Restore requires an empty installation. Your existing vault was not changed.',
  PROOF_CONFLICT_CHANGED:
    'The versions changed. Reload encrypted history before choosing again.',
  PROOF_RECOVERY_CONFLICT_REVIEW_REQUIRED:
    'This backup has unresolved Personal conflicts. Restore with its original master password and review them first.',
  PROOF_VAULT_LOCKED: 'Your vault locked. Unlock it to continue.',
  PROOF_DEVELOPER_GOOGLE_CLIENT_REQUIRED:
    'The developer must configure the registered Desktop OAuth client. You do not need Google Cloud Console.',
  PROOF_GOOGLE_FOLDER_PERMISSION_REQUIRED:
    'Google has not authorized these proof folders. Authorize the shared folders, then retry.',
  PROOF_NETWORK_UNAVAILABLE: 'Offline. Local encrypted changes are retained.',
  PROOF_SYNC_CONFLICT:
    'Conflicting encrypted branches are retained. Review them in Settings before saving more changes.',
  PROOF_SYNC_BUSY:
    'Drive synchronization is active. Retry your change after it finishes.',
}
export function WindowsLockbox() {
  const { page, navigate: setPage } = useNavigation()
  const [status, setStatus] = useState<Status | null>(null),
    [stored, setStored] = useState<VaultState | null>(null),
    [engine, setEngine] = useState<VaultEngine | null>(null),
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
    [dialog, setDialog] = useState<'add' | 'view' | 'edit' | 'delete' | null>(
      null,
    ),
    [generatedPassword, setGeneratedPassword] = useState(''),
    [folder, setFolder] = useState('')
  const active = useRef<VaultEngine | null>(null),
    pending = useRef<typeof draft>(null),
    seenState = useRef(''),
    operationBusy = useRef(false)
  const refresh = useCallback(async () => {
    const value = await request<Status>('status')
    setStatus(value)
    seenState.current = value.stateToken
    setStored(await api('state'))
    await request('renderer-ready')
  }, [])
  const lock = useCallback(() => {
    active.current?.lock()
    void request('lock-identity').catch(() => {})
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
    setGeneratedPassword('')
    setFolder('')
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
      void request('lock-identity').catch(() => {})
      if (pending.current) destroyKeys(pending.current.keys)
    }
  }, [refresh])
  useEffect(() => {
    const interval = setInterval(
      () =>
        void request<Status>('status')
          .then(async (value) => {
            setStatus(value)
            if (!value.identityUnlocked && active.current) lock()
            else if (
              active.current &&
              !operationBusy.current &&
              value.stateToken !== seenState.current
            ) {
              await active.current.refresh()
              setCredentials(active.current.credentials)
              seenState.current = value.stateToken
            }
          })
          .catch(() => {
            if (active.current?.locked) lock()
          }),
      5000,
    )
    return () => clearInterval(interval)
  }, [lock])
  useEffect(() => {
    if (!engine && !draft) return
    const idle = new IdleLock(lock),
      touch = () => {
        idle.touch()
        void request('touch-identity').catch(() => {})
      },
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
    operationBusy.current = true
    setBusy(true)
    setNotice('')
    try {
      await action()
      if (active.current && !active.current.locked)
        setCredentials(active.current.credentials)
      await refresh()
    } catch (error) {
      if (!active.current || active.current.locked)
        await request('lock-identity').catch(() => {})
      if (active.current?.locked) lock()
      const message =
        error instanceof Error ? error.message : 'Proof operation failed.'
      setNotice(messages[message] ?? message)
    } finally {
      operationBusy.current = false
      setBusy(false)
    }
  }
  function install(value: VaultEngine) {
    active.current = value
    setEngine(value)
    setCredentials(value.credentials)
  }
  const user = status?.role === 'partner' ? 'partner' : 'emmanuel'
  function add(password = '') {
    setSelected(null)
    setGeneratedPassword(password)
    setDialog('add')
  }
  function save(value: CredentialDraft) {
    void run(async () => {
      if (
        status?.googleTestMode &&
        (!value.name.startsWith('Fictional ') ||
          !new URL(value.url).hostname.endsWith('.invalid') ||
          !value.username.endsWith('@example.invalid'))
      )
        throw new Error(
          'Google testing accepts fictional names, .invalid websites and @example.invalid usernames only. Do not enter real credentials.',
        )
      await active.current!.saveCredential(
        value,
        dialog === 'edit' ? selected!.id : undefined,
      )
      setGeneratedPassword('')
      setDialog(null)
    })
  }
  async function changed() {
    if (active.current && !active.current.locked)
      setCredentials(active.current.credentials)
    await refresh()
  }
  if (!status || !stored)
    return (
      <main className="auth-loading">
        {notice || 'Opening Lockbox Preview...'}
      </main>
    )
  if (!engine)
    return (
      <main className="auth-page">
        <section className="panel auth-form-panel">
          <h1>Lockbox for Windows ? Preview</h1>
          <p>
            Fictional data only · independent {status.role} installation · no
            Lockbox server required
          </p>
          <p role="status">{notice}</p>
          <DriveTestMode
            status={status}
            busy={busy}
            onSwitch={() =>
              void run(async () => {
                await request('google-test-mode')
              })
            }
          />
          {!stored.profile && !draft && (
            <>
              <p>
                This computer is set up as the {status.role}. Personal vaults
                remain separate.
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await request('choose-role', {
                      role: status.role === 'owner' ? 'partner' : 'owner',
                    })
                  })
                }
              >
                Use this computer as{' '}
                {status.role === 'owner' ? 'partner' : 'owner'} instead
              </Button>
              <BackupRestore
                onRestored={async () => {
                  await refresh()
                  setNotice(
                    'Backup restored. Unlock with its master password. Reconnect your own Google account in Settings.',
                  )
                }}
              />
            </>
          )}
          {draft ? (
            <>
              <h2>Save and verify this recovery key</h2>
              <textarea
                className="form-input recovery-key"
                aria-label="Fictional proof recovery key"
                readOnly
                value={draft.recoveryCode}
              />
              <CopyButton
                onError={setNotice}
                value={draft.recoveryCode}
                label="Copy recovery key"
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
                    if ('state' in draft)
                      await request('unlock-identity', {
                        root: toBase64(draft.keys.root),
                      })
                    const value =
                      'state' in draft
                        ? await VaultEngine.finishRecovery(
                            api,
                            status.accountId,
                            draft,
                            recovery,
                          )
                        : await VaultEngine.finishSetup(
                            (path, body) =>
                              request<VaultState>('api', {
                                path,
                                body,
                                ...(path === 'setup'
                                  ? { setupRoot: toBase64(draft.keys.root) }
                                  : {}),
                              }),
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
                Confirm recovery and create local vault
              </Button>
            </>
          ) : (
            <>
              <h2>
                {stored.profile
                  ? 'Unlock local vault'
                  : 'Create master password'}
              </h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(async () => {
                    if (stored.profile) {
                      const keys = await unlockProfile(
                        status.accountId,
                        stored.profile.data,
                        password,
                      )
                      try {
                        await request('unlock-identity', {
                          root: toBase64(keys.root),
                        })
                      } finally {
                        destroyKeys(keys)
                      }
                      install(
                        await VaultEngine.unlock(
                          api,
                          status.accountId,
                          password,
                        ),
                      )
                    } else {
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
                <Field label="Master password" htmlFor="proof-master">
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
                    label="Confirm master password (required for setup or recovery)"
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
                  {stored.profile ? 'Unlock' : 'Prepare recovery information'}
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
                    aria-label="Existing recovery key"
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
        username: status.role === 'owner' ? 'Owner' : 'Partner',
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
            WINDOWS PREVIEW - fictional data only - no central Lockbox server
          </strong>
          <p>
            Google:{' '}
            {status.googleConnected
              ? status.google?.emailAddress
              : 'not connected'}{' '}
            ·{' '}
            {status.googleConfigured
              ? 'developer client configured'
              : 'developer registration missing'}{' '}
            · Last verified Drive round trip:{' '}
            {status.lastSync
              ? new Date(status.lastSync).toLocaleString()
              : 'never'}
          </p>
          <p className="field-hint">
            Saved locally. {status.pendingChanges} encrypted changes awaiting
            cloud upload. An unpaired Household stays local until sharing is
            configured.
          </p>
          {(status.conflicts.personal.length > 0 ||
            status.conflicts.household.length > 0) && (
            <p role="alert">
              Conflict detected. Both encrypted branches are retained. Open
              Settings to decrypt and explicitly review the conflicting
              versions.
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {status.lastError && (
            <p role="alert">{nativeErrorMessage(status.lastError)}</p>
          )}
          <Button
            disabled={
              busy ||
              !status.googleConfigured ||
              !status.liveSyncAllowed ||
              status.googleAuthorising
            }
            onClick={() =>
              void run(async () => {
                await request('connect')
              })
            }
          >
            {status.googleConnected
              ? 'Authorize shared folders'
              : 'Connect my Google account'}
          </Button>
          <Button
            variant="outline"
            disabled={
              busy ||
              !status.liveSyncAllowed ||
              !status.googleConnected ||
              !status.configuredFolders
            }
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
          <Button
            variant="outline"
            disabled={busy || !status.googleConnected}
            onClick={() =>
              void run(async () => {
                await request('disconnect')
              })
            }
          >
            Disconnect this installation
          </Button>
          <p className="field-hint">
            Disconnect removes this installation's saved tokens and stops sync.
            It does not revoke the other person's Google access. Requested
            scope: {status.scope}
          </p>
          <Button variant="ghost" onClick={() => setPage('settings')}>
            Settings, sharing and recovery
          </Button>
        </div>
      </div>
      {page === 'dashboard' && (
        <Dashboard
          credentials={credentials}
          user={user}
          displayName={status.role === 'owner' ? 'Owner' : 'Partner'}
          navigate={setPage}
          onAdd={() => add()}
          onSelect={(item) => {
            setSelected(item)
            setDialog('view')
          }}
          vaultActive
        />
      )}
      {['library', 'personal', 'shared'].includes(page) && (
        <>
          <VaultFolders
            engine={engine}
            selected={folder}
            onSelect={setFolder}
            onChanged={() => void changed()}
            onLock={lock}
          />
          <CredentialLibrary
            page={page}
            credentials={
              folder
                ? credentials.filter((c) => c.folderId === folder)
                : credentials
            }
            onSelect={(item) => {
              setSelected(item)
              setDialog('view')
            }}
            onAdd={() => add()}
            vaultActive
          />
        </>
      )}
      {page === 'generator' && (
        <PasswordGenerator
          notify={setNotice}
          onUse={(password) => add(password)}
        />
      )}
      {page === 'settings' && (
        <>
          <DriveTestMode
            status={status}
            busy={busy}
            onSwitch={() =>
              void run(async () => {
                await request('google-test-mode')
              })
            }
          />
          <DesktopSecurity engine={engine} onChanged={changed} onLock={lock} />
          <ConflictReview engine={engine} onChanged={changed} onLock={lock} />
          <section className="panel settings-panel">
            <div className="settings-body">
              <h2>Independent Windows installation</h2>
              <p>Account ID: {status.accountId}</p>
              <p>
                Compare this public identity fingerprint directly with the other
                participant before approving a grant:
              </p>
              <code>{status.fingerprint}</code>
              <Button
                disabled={
                  busy || !status.liveSyncAllowed || !status.googleConnected
                }
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
                  <h3>Owner Household setup</h3>
                  <Button
                    disabled={
                      busy ||
                      !status.liveSyncAllowed ||
                      !status.googleConnected ||
                      status.configuredFolders
                    }
                    onClick={() =>
                      void run(async () => {
                        await request('create-folders')
                      })
                    }
                  >
                    Create new fictional Drive folders
                  </Button>
                  <Button
                    disabled={busy || Boolean(engine.household)}
                    onClick={() => void run(() => engine.createHousehold())}
                  >
                    Create encrypted Household Vault
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
                      !status.liveSyncAllowed ||
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
                          setGrant(
                            JSON.stringify(await request('export-grant')),
                          ),
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
                    disabled={
                      busy ||
                      !status.liveSyncAllowed ||
                      status.householdApproved
                    }
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
                    Unlock approved Household with my own master-protected
                    keyring
                  </Button>
                </>
              )}
              <p>
                This preview has no separate local login-password layer, final
                device enrollment/revocation or Household key-rotation protocol.
                Portable backup recovery preserves the old device identity.
                Independent security review and real two-account Google tests
                are required before using real credentials.
              </p>
            </div>
          </section>
        </>
      )}
      {dialog === 'add' && (
        <CredentialForm
          user={user}
          initialVault={page === 'shared' ? 'shared' : 'personal'}
          initialPassword={generatedPassword}
          onClose={() => {
            setDialog(null)
            setGeneratedPassword('')
          }}
          onSave={save}
          persisted
          folders={engine.folders}
          busy={busy}
          sharedAvailable={Boolean(engine.household?.joined)}
        />
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
          folders={engine.folders}
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
