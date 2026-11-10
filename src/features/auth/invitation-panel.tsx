import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import {
  authRequest,
  accountError,
  AuthApiError,
  type AccountSession,
} from './api'
export function InvitationPanel({ session }: { session: AccountSession }) {
  const [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [expires, setExpires] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  if (session.user.role !== 'administrator') return null
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setCode('')
    try {
      const result = await authRequest<{
        inviteCode: string
        expiresAt: number
      }>('invitations', {
        method: 'POST',
        csrfToken: session.csrfToken,
        body: { password },
      })
      setPassword('')
      setCode(result.inviteCode)
      setExpires(result.expiresAt)
    } catch (reason) {
      setError(
        reason instanceof AuthApiError &&
          reason.code === 'REGISTRATION_NOT_AVAILABLE'
          ? 'Both household accounts are already active. A new invitation is not available.'
          : accountError(reason),
      )
    } finally {
      setBusy(false)
    }
  }
  const link = code ? window.location.origin + '/#/join/' + code : ''
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>Invite your partner</h2>
        <p>
          Your partner creates a separate Lockbox account and master password.
          This invitation grants account registration only. Your Personal vault
          stays private. Household access is granted separately in Vault
          Settings.
        </p>
        <form onSubmit={(e) => void submit(e)}>
          <Field label="Your login password" htmlFor="invite-password">
            <Input
              id="invite-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={512}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button disabled={busy}>Create household invitation</Button>
        </form>
        {code && (
          <>
            <p>
              This link works once and expires{' '}
              {new Date(expires).toLocaleString()}. Send it privately. Creating
              another invitation invalidates the previous link.
            </p>
            <textarea
              aria-label="Household invitation link"
              className="form-input"
              readOnly
              value={link}
            />
            <CopyButton
              value={link}
              label="Copy invitation link"
              showLabel
              onError={setError}
            />
            <Button variant="ghost" onClick={() => setCode('')}>
              Hide invitation
            </Button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  )
}
