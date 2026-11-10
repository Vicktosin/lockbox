import { useCallback, useEffect, useRef, useState } from 'react'
import { Cloud, RefreshCw, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import type { AccountSession } from '../auth/api'
import type { DriveStatus } from '../../../shared/drive'

const messages: Record<string, string> = {
  DRIVE_APPLICATION_NOT_CONFIGURED:
    'Google Drive is not available in this installation yet. The Lockbox maintainer must enable the Google connection.',
  DRIVE_FOLDER_LINK_INVALID: 'Paste the complete Google Drive folder link.',
  DRIVE_FOLDER_NOT_WRITABLE:
    'Choose a folder owned by the Google account you connected.',
  DRIVE_FOLDER_NOT_PRIVATE:
    'This folder is shared with other people or publicly accessible. Choose a private folder owned by your Google account.',
  DRIVE_AUTHORIZATION_CANCELLED:
    'Google permission was not approved. You can try connecting again.',
  DRIVE_AUTHORIZATION_EXPIRED:
    'The connection request expired. Select Connect Google Drive again.',
  DRIVE_PERMISSION_REQUIRED:
    'Google Drive permission was not granted. Reconnect and approve the requested access.',
  DRIVE_OFFLINE_ACCESS_REQUIRED:
    'Google did not provide ongoing access. Please reconnect.',
  DRIVE_RECONNECT_REQUIRED:
    'Google access has expired or been revoked. The administrator needs to reconnect.',
  DRIVE_CONFLICT:
    'Different vault copies were found. Nothing has been overwritten. Review the choices below.',
  DRIVE_CONFLICT_CHANGED:
    'The copies changed during review. Refresh and review the latest copies.',
  DRIVE_CONFLICT_APPROVAL_REQUIRED:
    'Each household account must approve the same copy before it can replace private vault data.',
  DRIVE_SYNC_BUSY: 'Synchronisation is already running. Please wait a moment.',
  DRIVE_REMOTE_REVOCATION_UNCONFIRMED:
    'Lockbox disconnected and removed its saved tokens. Google could not confirm revocation; the administrator can revoke access in their Google account if needed.',
  DRIVE_HISTORY_MISSING:
    'Cloud history is missing. Local vaults are safe; synchronisation stopped to prevent data loss.',
  DRIVE_DATA_AUTHENTICATION_FAILED:
    'Cloud data could not be verified. Local vaults are safe; synchronisation stopped.',
  DRIVE_ACCESS_DENIED:
    'Google Drive access was denied. Check the selected folder or reconnect.',
  DRIVE_FILE_NOT_FOUND:
    'A Lockbox cloud file or folder is missing. Local data has been preserved.',
  DRIVE_NETWORK_ERROR:
    'Google Drive could not be reached. Lockbox will retry automatically.',
  DRIVE_TEMPORARILY_UNAVAILABLE:
    'Google Drive is temporarily unavailable. Lockbox will retry automatically.',
}
export function DriveSettings({
  session,
  onExpired,
}: {
  session: AccountSession
  onExpired: () => void
}) {
  const [status, setStatus] = useState<DriveStatus | null>(null),
    [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const live = useRef(true),
    polling = useRef(false),
    changing = useRef(false),
    revision = useRef(0)
  const request = useCallback(
    async (path: string, body?: unknown) => {
      const response = await fetch('/api/drive/' + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(body ? 120000 : 10000),
        headers: body
          ? {
              'Content-Type': 'application/json',
              'X-CSRF-Token': session.csrfToken,
            }
          : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (response.status === 401) {
        onExpired()
        throw new Error('Sign in again to continue.')
      }
      const value = (await response.json()) as DriveStatus & {
        code?: string
        authorizationUrl?: string
      }
      if (!response.ok)
        throw new Error(
          messages[value.code ?? ''] ??
            'Google Drive could not complete this request. Your local vaults have been preserved.',
        )
      if (value.signInAgain) {
        onExpired()
        return value
      }
      return value
    },
    [session.csrfToken, onExpired],
  )
  const refresh = useCallback(async () => {
    if (polling.current || changing.current) return
    polling.current = true
    const attempt = revision.current
    try {
      const value = await request('status')
      if (live.current && attempt === revision.current) {
        setStatus(value)
        setError('')
      }
    } catch (reason) {
      if (live.current && attempt === revision.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to check Google Drive.',
        )
    } finally {
      polling.current = false
    }
  }, [request])
  useEffect(() => {
    live.current = true
    const initial = setTimeout(() => void refresh(), 0)
    const timer = setInterval(() => void refresh(), 15000)
    return () => {
      live.current = false
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])
  async function act(path: string, body: unknown) {
    changing.current = true
    revision.current++
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const value = await request(path, body)
      if (!live.current) return
      if (value.authorizationUrl) {
        const url = new URL(value.authorizationUrl)
        if (
          url.origin !== 'https://accounts.google.com' ||
          url.pathname !== '/o/oauth2/v2/auth'
        )
          throw new Error('Invalid Google authorisation destination.')
        window.location.assign(url.href)
        return
      }
      setStatus(value)
      if (path === 'disconnect')
        setNotice(
          'Disconnected. Your local vaults and encrypted cloud copies have been kept.',
        )
      if (path === 'resolve' && value.conflict)
        setNotice(
          'Your choice is recorded. Other household accounts must approve the same copy.',
        )
    } catch (reason) {
      if (live.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Google Drive request failed.',
        )
        try {
          const current = await request('status')
          if (live.current) setStatus(current)
        } catch {
          /* Keep the original safe error. */
        }
      }
    } finally {
      changing.current = false
      if (live.current) setBusy(false)
    }
  }
  const configured = status?.configured,
    connected = status?.connected
  return (
    <section
      className="panel settings-panel drive-settings"
      aria-labelledby="drive-settings-heading"
    >
      <div className="settings-heading">
        <span className="setting-icon">
          <Cloud />
        </span>
        <div>
          <h2 id="drive-settings-heading">Google Drive</h2>
          <p>Encrypted cloud storage for your household.</p>
        </div>
        <span className="subtle-tag">
          {!status
            ? 'CHECKING'
            : !configured
              ? 'NOT AVAILABLE'
              : connected
                ? 'CONNECTED'
                : status.state === 'reauth-required'
                  ? 'RECONNECT NEEDED'
                  : 'NOT CONNECTED'}
        </span>
      </div>
      <div className="settings-body">
        {!configured && status && (
          <p role="status">
            {messages.DRIVE_APPLICATION_NOT_CONFIGURED} No Google account is
            connected.
          </p>
        )}
        {status?.administrator ? (
          <>
            <Field
              label="Google Drive folder link"
              htmlFor="drive-folder-link"
              hint="Paste a private folder link, then approve Google’s permission request. A link alone does not grant access."
            >
              <Input
                id="drive-folder-link"
                type="url"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                disabled={busy || connected}
                maxLength={2000}
              />
            </Field>
            {!connected && (
              <Button
                disabled={busy || !configured || !link.trim()}
                onClick={() => void act('connect', { folderLink: link })}
              >
                <Cloud />
                {busy ? 'Connecting…' : 'Connect Google Drive'}
              </Button>
            )}
          </>
        ) : (
          status && (
            <p className="field-hint">
              The household administrator manages the Google connection. You can
              synchronise your vaults through Lockbox without using their Google
              account.
            </p>
          )
        )}
        {status?.folder && (
          <dl className="drive-summary">
            <div>
              <dt>Selected folder</dt>
              <dd>{status.folder.name}</dd>
            </div>
            <div>
              <dt>Connected account</dt>
              <dd>
                {connected
                  ? (status.account ?? 'Managed by household administrator')
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt>Last successful sync</dt>
              <dd>
                {status.lastSync
                  ? new Date(status.lastSync).toLocaleString()
                  : 'Not yet synchronised'}
              </dd>
            </div>
            <div>
              <dt>Sync status</dt>
              <dd>
                {status.syncing || busy
                  ? 'Working…'
                  : status.conflict
                    ? 'Review required'
                    : status.error
                      ? 'Needs attention'
                      : connected
                        ? 'Automatic synchronisation enabled'
                        : 'Disconnected'}
              </dd>
            </div>
          </dl>
        )}
        {connected && (
          <div className="drive-actions">
            <Button
              disabled={busy || status.syncing}
              onClick={() => void act('sync', {})}
            >
              <RefreshCw />
              Sync Now
            </Button>
            {status.administrator && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act('disconnect', {})}
              >
                <Unplug />
                Disconnect
              </Button>
            )}
          </div>
        )}
        {status?.state === 'reauth-required' && status.administrator && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act('disconnect', {})}
          >
            Clear expired connection
          </Button>
        )}
        {status?.namespaces.length ? (
          <ul className="drive-namespace-list">
            {status.namespaces.map((namespace) => (
              <li key={namespace.namespace}>
                <strong>{namespace.label}</strong>
                <span>
                  Revision {namespace.revision} ·{' '}
                  {namespace.lastSync
                    ? 'Synced ' + new Date(namespace.lastSync).toLocaleString()
                    : 'Waiting for sync'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {status?.conflict && (
          <div className="drive-conflict" role="alert">
            <h3>Choose which encrypted copy to keep</h3>
            <p>
              All versions remain preserved in Drive. Each household account
              must approve the same choice before any private vault is replaced.
              Downloading cloud changes signs accounts out so their updated
              vaults can be unlocked safely.
            </p>
            {status.conflict.canResolve ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act('resolve', {
                      id: status.conflict!.id,
                      copy: 'local',
                    })
                  }
                >
                  Keep this device’s copy
                </Button>
                {status.conflict.cloudCopies.map((copy, index) => (
                  <Button
                    key={copy.hash}
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act('resolve', {
                        id: status.conflict!.id,
                        copy: copy.hash,
                      })
                    }
                  >
                    Use cloud copy {index + 1} ·{' '}
                    {new Date(copy.createdAt).toLocaleString()}
                  </Button>
                ))}
                {status.conflict.approvedCopy && (
                  <p>
                    Your choice is recorded.{' '}
                    {status.conflict.waitingForOthers
                      ? 'Waiting for the other account’s approval.'
                      : 'Both accounts must choose the same copy.'}
                  </p>
                )}
              </>
            ) : (
              <p>A vault owner must review these copies.</p>
            )}
          </div>
        )}
        {(error || status?.error) && (
          <p className="form-error" role="alert">
            {error ||
              messages[status?.error ?? ''] ||
              'Synchronisation stopped safely. Your local vaults have not been overwritten.'}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <Button variant="ghost" onClick={() => void refresh()}>
            Refresh connection status
          </Button>
        )}
        <p className="field-hint">
          Only encrypted vault files are sent to the selected folder. Master
          passwords and vault keys stay under Lockbox’s existing encryption
          design. Previously copied secrets cannot be recalled.
        </p>
      </div>
    </section>
  )
}
