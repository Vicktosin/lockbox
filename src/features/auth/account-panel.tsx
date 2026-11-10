import { useEffect, useState } from 'react'
import { Laptop, LogOut, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RecoveryPanel } from './recovery-panel'
import { InvitationPanel } from './invitation-panel'
import {
  authRequest,
  accountError,
  AuthApiError,
  type AccountSession,
  type AccountDevice,
} from './api'

export function AccountPanel({
  session,
  onSignedOut,
  onExpired,
}: {
  session: AccountSession
  onSignedOut: () => void
  onExpired: () => void
}) {
  const [devices, setDevices] = useState<AccountDevice[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    let live = true
    authRequest<{ sessions: AccountDevice[] }>('sessions')
      .then((value) => {
        if (live) {
          setDevices(value.sessions)
          setError('')
        }
      })
      .catch((reason) => {
        if (live) {
          if (reason instanceof AuthApiError && reason.status === 401)
            onExpired()
          else setError(accountError(reason))
        }
      })
    return () => {
      live = false
    }
  }, [revision, onExpired])
  async function revoke(device: AccountDevice) {
    setBusy(true)
    setError('')
    try {
      await authRequest(
        'sessions/' + encodeURIComponent(device.id) + '/revoke',
        { method: 'POST', csrfToken: session.csrfToken },
      )
      if (device.current) onSignedOut()
      else setRevision((value) => value + 1)
    } catch (reason) {
      if (reason instanceof AuthApiError && reason.status === 401) onExpired()
      else setError(accountError(reason))
    } finally {
      setBusy(false)
    }
  }
  async function logoutAll() {
    setBusy(true)
    setError('')
    try {
      await authRequest('logout-all', {
        method: 'POST',
        csrfToken: session.csrfToken,
      })
      onSignedOut()
    } catch (reason) {
      if (reason instanceof AuthApiError && reason.status === 401) onExpired()
      else setError(accountError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <section className="panel account-panel">
        <div className="settings-heading">
          <span className="setting-icon">
            <Laptop />
          </span>
          <div>
            <h2>Your Lockbox account</h2>
            <p>
              Signed in as <strong>{session.user.username}</strong> ·{' '}
              {session.user.role}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh active sessions"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw />
          </Button>
        </div>
        <div className="settings-body">
          <h3>Active sessions</h3>
          <p className="field-hint">
            Browser labels are approximate, not proof of device identity.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <ul className="account-device-list">
            {devices.map((device) => (
              <li key={device.id}>
                <Laptop size={18} />
                <div>
                  <strong>
                    {device.device}
                    {device.current ? ' · This session' : ''}
                  </strong>
                  <small>
                    Last active {new Date(device.lastSeenAt).toLocaleString()}
                  </small>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void revoke(device)}
                >
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void logoutAll()}
          >
            <LogOut />
            Sign out all sessions
          </Button>
          <p className="field-hint">
            Signing out locks the vault. Saved changes remain encrypted. Keep a
            login recovery code outside Lockbox.
          </p>
        </div>
      </section>
      <RecoveryPanel session={session} />
      <InvitationPanel session={session} />
    </>
  )
}
