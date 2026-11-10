import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import { RecoveryGuide } from '../settings/recovery-guide'
import { authRequest, accountError, type AccountSession } from './api'
export function RecoveryPanel({ session }: { session: AccountSession }) {
  const [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setCode('')
    try {
      const result = await authRequest<{ code: string }>('recovery-code', {
        method: 'POST',
        csrfToken: session.csrfToken,
        body: { password },
      })
      setCode(result.code)
      setPassword('')
    } catch (reason) {
      setError(accountError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <section className="panel settings-panel">
        <div className="settings-body">
          <h2>Login recovery</h2>
          <p>
            Save a login recovery code somewhere safe outside Lockbox. It resets
            your login password once and signs out every session. It cannot
            unlock your vault. Generating another code replaces the old one.
          </p>
          <form onSubmit={(e) => void submit(e)}>
            <Field
              label="Current login password"
              htmlFor="recovery-login-password"
            >
              <Input
                id="recovery-login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={512}
              />
            </Field>
            <Button disabled={busy}>Generate login recovery code</Button>
          </form>
          {code && (
            <>
              <textarea
                aria-label="Login recovery code"
                className="form-input recovery-key"
                value={code}
                readOnly
              />
              <CopyButton
                value={code}
                label="Copy login recovery code"
                showLabel
                onError={setError}
              />
              <Button variant="ghost" onClick={() => setCode('')}>
                I saved it — hide code
              </Button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <p className="field-hint">
            If your login password and login recovery code are both lost, there
            is no automatic reset. If your master password and vault recovery
            key are both lost, encrypted personal contents cannot be recovered.
            A household partner may still have access to shared contents.
          </p>
        </div>
      </section>
      <RecoveryGuide />
    </>
  )
}
