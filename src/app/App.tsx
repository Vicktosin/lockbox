import { AuthGate } from '@/features/auth/auth-gate'
import { AccountPanel } from '@/features/auth/account-panel'
import type { AccountSession } from '@/features/auth/api'
import { useEffect, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Dashboard } from '@/features/dashboard/dashboard'
import { CredentialLibrary } from '@/features/credentials/credential-library'
import {
  CredentialDetails,
  CredentialForm,
  DeleteCredential,
} from '@/features/credentials/credential-dialogs'
import { mockCredentials } from '@/features/credentials/mock-data'
import type {
  Credential,
  CredentialDraft,
  UserId,
  Vault,
} from '@/features/credentials/types'
import { PasswordGenerator } from '@/features/generator/password-generator'
import { Settings, type Appearance } from '@/features/settings/settings'
import { useNavigation } from '@/hooks/use-navigation'
import type { VaultEngine } from '@/features/vault/engine'
import { VaultSettings } from '@/features/vault/vault-settings'
import { ExtensionBridge } from '@/features/extension/extension-bridge'
import { VaultFolders } from '@/features/vault/folders'
import { DriveSettings } from '@/features/drive/drive-settings'
import { SyncIndicator } from '@/features/drive/sync-indicator'
import { BackupSettings } from '@/features/settings/backup-settings'
import { BackupAlert } from '@/features/settings/backup-alert'

type DialogState =
  | { type: 'details' | 'edit' | 'delete'; id: string }
  | { type: 'add'; vault: Vault; password?: string }
  | { type: 'reset' }
  | null
export function DemoWorkspace({
  accountSession,
  onLogout,
  onSignedOut,
  onExpired,
  engine,
  onLock,
}: {
  accountSession?: AccountSession
  onLogout?: () => void
  onSignedOut?: () => void
  onExpired?: () => void
  engine?: VaultEngine
  onLock?: () => void
} = {}) {
  const { page, navigate } = useNavigation()
  const [credentials, setCredentials] = useState<Credential[]>(() =>
    engine ? engine.credentials : structuredClone(mockCredentials),
  )
  const [user, setUser] = useState<UserId>(
    accountSession?.user.role === 'member' ? 'partner' : 'emmanuel',
  )
  const [dialog, setDialog] = useState<DialogState>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [appearance, setAppearance] = useState<Appearance>('light')
  const [folder, setFolder] = useState(''),
    [busy, setBusy] = useState(false)
  const accessible = engine
    ? credentials
    : credentials.filter(
        (item) => item.vault === 'shared' || item.owner === user,
      )
  const selected =
    dialog && 'id' in dialog
      ? accessible.find((item) => item.id === dialog.id)
      : undefined
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        appearance === 'dark' || (appearance === 'system' && media.matches),
      )
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [appearance])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  function add() {
    setDialog({ type: 'add', vault: page === 'shared' ? 'shared' : 'personal' })
  }
  function changed() {
    if (engine && !engine.locked) setCredentials(engine.credentials)
  }
  async function vaultOperation(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      if (!engine?.locked) {
        changed()
        setDialog(null)
        setNotice('Encrypted vault saved.')
      }
    } catch (error) {
      if (engine?.locked) onLock?.()
      else
        setNotice(
          error instanceof Error ? error.message : 'Vault operation failed.',
        )
    } finally {
      setBusy(false)
    }
  }
  function save(draft: CredentialDraft) {
    if (engine) {
      void vaultOperation(() =>
        engine.saveCredential(
          draft,
          dialog?.type === 'edit' ? selected?.id : undefined,
        ),
      )
      return
    }
    if (selected && dialog?.type === 'edit') {
      setCredentials((items) =>
        items.map((item) =>
          item.id === selected.id ? { ...item, ...draft } : item,
        ),
      )
      setDialog({ type: 'details', id: selected.id })
      setNotice(
        'Sample credential updated. Changes are only kept for this session.',
      )
    } else {
      const item: Credential = {
        ...draft,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        color: 'purple',
      }
      setCredentials((items) => [item, ...items])
      setDialog({ type: 'details', id: item.id })
      setNotice('Sample credential added to your demo vault.')
    }
  }
  return (
    <AppShell
      page={page}
      navigate={navigate}
      account={accountSession?.user}
      onLogout={onLogout}
      credentials={accessible}
      user={user}
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
      vaultActive={Boolean(engine)}
      onLock={onLock}
    >
      {engine && (
        <div className="vault-toolbar">
          <span>
            {busy ? 'Encrypting and saving…' : 'Encrypted before saving'}
          </span>
          {onExpired && (
            <SyncIndicator
              onSettings={() => navigate('settings')}
              onExpired={onExpired}
            />
          )}
          {accountSession?.user.role === 'administrator' && (
            <BackupAlert onSettings={() => navigate('settings')} />
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void vaultOperation(() => engine.refresh())}
          >
            Refresh vault
          </Button>
        </div>
      )}
      {page === 'dashboard' && (
        <Dashboard
          credentials={accessible}
          user={user}
          displayName={accountSession?.user.username}
          vaultActive={Boolean(engine)}
          navigate={navigate}
          onAdd={add}
          onSelect={(item) => setDialog({ type: 'details', id: item.id })}
        />
      )}
      {(['library', 'personal', 'shared'] as string[]).includes(page) && (
        <>
          {engine && onLock && (
            <VaultFolders
              engine={engine}
              selected={folder}
              onSelect={setFolder}
              onChanged={changed}
              onLock={onLock}
            />
          )}
          {engine && (
            <ExtensionBridge engine={engine} user={user} onChanged={changed} />
          )}
          <CredentialLibrary
            key={`${page}-${user}`}
            page={page}
            credentials={
              folder
                ? accessible.filter((item) => item.folderId === folder)
                : accessible
            }
            vaultActive={Boolean(engine)}
            onSelect={(item) => setDialog({ type: 'details', id: item.id })}
            onAdd={add}
          />
        </>
      )}
      {page === 'generator' && (
        <PasswordGenerator
          notify={setNotice}
          onUse={(password) =>
            setDialog({ type: 'add', vault: 'personal', password })
          }
        />
      )}
      {page === 'settings' && accountSession && onSignedOut && onExpired && (
        <AccountPanel
          session={accountSession}
          onSignedOut={onSignedOut}
          onExpired={onExpired}
        />
      )}
      {page === 'settings' && (
        <>
          {engine && accountSession && onExpired && (
            <DriveSettings session={accountSession} onExpired={onExpired} />
          )}
          {accountSession?.user.role === 'administrator' && (
            <BackupSettings session={accountSession} />
          )}
          {engine && onLock && (
            <VaultSettings
              engine={engine}
              onChanged={changed}
              onLock={onLock}
            />
          )}
          <Settings
            vaultActive={Boolean(engine)}
            user={user}
            onUserChange={(next) => {
              setUser(next)
              setDialog(null)
              setNotice(
                'Demo profile switched. Shared credentials stay available to both users.',
              )
            }}
            appearance={appearance}
            onAppearanceChange={setAppearance}
            onReset={() => setDialog({ type: 'reset' })}
          />
        </>
      )}
      {dialog?.type === 'add' && (
        <CredentialForm
          user={user}
          initialVault={dialog.vault}
          initialPassword={dialog.password}
          onClose={() => setDialog(null)}
          onSave={save}
          persisted={Boolean(engine)}
          folders={engine?.folders}
          busy={busy}
          sharedAvailable={!engine || Boolean(engine.household?.joined)}
        />
      )}
      {dialog?.type === 'edit' && selected && (
        <CredentialForm
          credential={selected}
          user={user}
          onClose={() => setDialog({ type: 'details', id: selected.id })}
          onSave={save}
          persisted={Boolean(engine)}
          folders={engine?.folders}
          busy={busy}
          sharedAvailable={!engine || Boolean(engine.household?.joined)}
        />
      )}
      {dialog?.type === 'details' && selected && (
        <CredentialDetails
          credential={selected}
          notify={setNotice}
          persisted={Boolean(engine)}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ type: 'edit', id: selected.id })}
          onDelete={() => setDialog({ type: 'delete', id: selected.id })}
        />
      )}
      {dialog?.type === 'delete' && selected && (
        <DeleteCredential
          credential={selected}
          persisted={Boolean(engine)}
          busy={busy}
          onClose={() => setDialog({ type: 'details', id: selected.id })}
          onConfirm={() => {
            if (engine) {
              void vaultOperation(() => engine.deleteCredential(selected.id))
              return
            }
            setCredentials((items) =>
              items.filter((item) => item.id !== selected.id),
            )
            setDialog(null)
            setNotice('Sample credential deleted.')
          }}
        />
      )}
      {dialog?.type === 'reset' && (
        <Modal
          title="Restore the demo workspace?"
          description="All sample credentials will return to their original state for both profiles."
          onClose={() => setDialog(null)}
        >
          <p className="reset-message">
            Any credentials you added, edited or deleted in this session will be
            reset.
          </p>
          <div className="modal-actions">
            <Button variant="outline" autoFocus onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setCredentials(structuredClone(mockCredentials))
                setDialog(null)
                setNotice(
                  'Original demo credentials restored for both profiles.',
                )
              }}
            >
              Reset demo data
            </Button>
          </div>
        </Modal>
      )}
      <div className="toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="toast">
            <CheckCircle2 size={19} />
            <span>{notice}</span>
            <button
              onClick={() => setNotice('')}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function App() {
  return <AuthGate />
}
