import { useEffect, useState } from 'react'
import { Cloud, FolderOpen, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GoogleWebSession } from './google-auth'
import { selectGoogleDriveFolder } from './google-picker'

const folderStorageKey = 'lockbox.drive-folder.v1'

class FolderCheckError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getStoredFolderId() {
  const value = localStorage.getItem(folderStorageKey) ?? ''
  return /^[A-Za-z0-9_-]{10,150}$/.test(value) ? value : ''
}

async function checkFolder(session: GoogleWebSession, id: string) {
  const response = await fetch(
    '/api/google/folder?id=' + encodeURIComponent(id),
    {
      headers: { Authorization: 'Bearer ' + session.accessToken },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  )
  const value = (await response.json().catch(() => ({}))) as {
    id?: string
    name?: string
  }
  if (!response.ok || value.id !== id || typeof value.name !== 'string')
    throw new FolderCheckError(
      response.status,
      response.status === 403 || response.status === 404
        ? 'That Drive folder is unavailable to this Google account. Select the shared folder again.'
        : 'Unable to verify the saved Drive folder. Your selection is kept; try again.',
    )
  return { id: value.id, name: value.name }
}

export function GoogleDriveSetup({
  session,
  onFolderReady,
  onSignOut,
  compact = false,
}: {
  session: GoogleWebSession
  onFolderReady: (folder: { id: string; name: string }) => void
  onSignOut: () => void
  compact?: boolean
}) {
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const id = getStoredFolderId()
    if (!id) return
    void checkFolder(session, id)
      .then((value) => {
        if (live) {
          setFolder(value)
          onFolderReady(value)
        }
      })
      .catch((reason: unknown) => {
        if (!live) return
        if (
          reason instanceof FolderCheckError &&
          [400, 403, 404].includes(reason.status)
        ) {
          localStorage.removeItem(folderStorageKey)
          setFolder(null)
        }
        setError(
          reason instanceof Error
            ? reason.message
            : 'Drive folder check failed.',
        )
      })
    return () => {
      live = false
    }
  }, [session, onFolderReady])

  async function chooseFolder(create: boolean) {
    setBusy(true)
    setError('')
    try {
      let selected: { id: string; name: string }
      if (create) {
        const response = await fetch('/api/google/folder', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + session.accessToken },
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        })
        const value = (await response.json()) as {
          id?: string
          name?: string
        }
        if (!response.ok || typeof value.id !== 'string')
          throw new Error('Unable to create a private Lockbox Drive folder.')
        selected = { id: value.id, name: value.name ?? 'LOCKBOX' }
      } else {
        selected = await selectGoogleDriveFolder(session)
        selected = await checkFolder(session, selected.id)
      }
      localStorage.setItem(folderStorageKey, selected.id)
      setFolder(selected)
      onFolderReady(selected)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Drive setup failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="panel settings-panel"
      aria-labelledby="drive-setup-title"
    >
      <div className="settings-heading">
        <span className="setting-icon">
          <Cloud />
        </span>
        <div>
          <h2 id="drive-setup-title">Google Drive storage</h2>
          <p>Encrypted vault files stay in your Google Drive.</p>
        </div>
      </div>
      <div className="settings-body">
        <p>
          Signed in as <strong>{session.identity.email}</strong>. Your personal
          vault is stored in this app’s private Drive data. The selected folder
          is used only for the shared Household vault.
        </p>
        {folder && (
          <p role="status">
            Household folder: <strong>{folder.name}</strong>
          </p>
        )}
        {!folder && (
          <p className="field-hint">
            Create a private folder for a new Household vault, or choose the
            folder the owner shared with you. Password data remains encrypted
            before it leaves this device.
          </p>
        )}
        <div className="drive-actions">
          <Button
            disabled={busy}
            onClick={() => void chooseFolder(false)}
            variant={folder ? 'outline' : 'default'}
          >
            <FolderOpen />
            {busy
              ? 'Opening Drive…'
              : folder
                ? 'Change folder'
                : 'Choose shared folder'}
          </Button>
          {!folder && (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void chooseFolder(true)}
            >
              Create Household folder
            </Button>
          )}
          {compact && (
            <Button variant="ghost" onClick={onSignOut}>
              <LogOut />
              Sign out of Google
            </Button>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
