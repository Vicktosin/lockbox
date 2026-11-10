import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { authRequest, accountError, type AccountSession } from './api'

export function AuthScreen({
  onAuthenticated,
  notice = '',
  serviceError = '',
  onRetry,
}: {
  onAuthenticated: (session: AccountSession) => void
  notice?: string
  serviceError?: string
  onRetry: () => void
}) {
  const [initialInvite] = useState(
    () =>
      /^#\/join\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1] ?? '',
  )
  useEffect(() => {
    if (initialInvite)
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search + '#/join',
      )
  }, [initialInvite])
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>(
    initialInvite ? 'register' : 'login',
  )
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [invite, setInvite] = useState(initialInvite)
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('')
  function switchMode(next: 'login' | 'register' | 'recover') {
    setMode(next)
    setError('')
    setSuccess('')
    setPassword('')
    setConfirmation('')
    setVisible(false)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (mode !== 'login' && password !== confirmation) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'recover') {
        await authRequest('recover', {
          method: 'POST',
          body: {
            username,
            code: invite.trim(),
            password,
            passwordConfirmation: confirmation,
          },
        })
        setMode('login')
        setSuccess(
          'Login password reset. Sign in, then unlock with your master password or vault recovery key. Generate a new login recovery code in Settings.',
        )
        setPassword('')
        setConfirmation('')
        setInvite('')
      } else if (mode === 'register') {
        await authRequest('register', {
          method: 'POST',
          body: {
            username,
            password,
            passwordConfirmation: confirmation,
            inviteCode: invite.trim(),
          },
        })
        setMode('login')
        setSuccess('Account created. Sign in with your username and password.')
        setPassword('')
        setConfirmation('')
        setInvite('')
      } else {
        const session = await authRequest<AccountSession>('login', {
          method: 'POST',
          body: { username, password },
        })
        setPassword('')
        onAuthenticated(session)
      }
    } catch (reason) {
      setError(accountError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-intro">
        <a className="auth-brand" href="#/dashboard">
          <span className="brand-mark">
            <LockKeyhole size={22} />
          </span>
          lockbox<span className="brand-dot">.</span>
        </a>
        <span className="eyebrow">A SPACE FOR YOUR HOUSEHOLD</span>
        <h1>
          One account.
          <br />A little peace of mind.
        </h1>
        <p>
          Sign in to your Lockbox account. Your familiar workspace is right
          here.
        </p>
        <div className="auth-security-note">
          <ShieldCheck size={19} />
          <span>
            Account login and vault unlocking are separate. Your master password
            stays on this device. Independent security review is pending.
          </span>
        </div>
      </div>
      <section className="panel auth-form-panel" aria-labelledby="auth-heading">
        <div className="auth-tabs" role="group" aria-label="Account access">
          <button
            aria-pressed={mode === 'login'}
            onClick={() => switchMode('login')}
            disabled={busy}
          >
            Sign in
          </button>
          <button
            aria-pressed={mode === 'register'}
            onClick={() => switchMode('register')}
            disabled={busy}
          >
            Create account
          </button>
          <button
            aria-pressed={mode === 'recover'}
            onClick={() => switchMode('recover')}
            disabled={busy}
          >
            Recover login
          </button>
        </div>
        <h2 id="auth-heading">
          {mode === 'recover'
            ? 'Recover your account'
            : mode === 'register'
              ? 'Create your Lockbox account'
              : notice
                ? 'You’re signed out'
                : 'Welcome back'}
        </h2>
        <p className="auth-description">
          {mode === 'recover'
            ? 'Use your saved login recovery code. It cannot decrypt your vault.'
            : mode === 'register'
              ? 'Use your private invitation to create your account. The first administrator uses an administrator invitation; a household member uses a household invitation. Your invitation determines your access.'
              : 'Use your username and login password to continue.'}
        </p>
        {notice && (
          <p className="auth-message" role="status">
            {notice}
          </p>
        )}
        {success && (
          <p className="auth-message" role="status">
            {success}
          </p>
        )}
        {serviceError && (
          <div className="auth-service-error">
            <p>{serviceError}</p>
            <button onClick={onRetry}>Retry connection</button>
          </div>
        )}
        <form onSubmit={(e) => void submit(e)}>
          <Field
            label="Username"
            htmlFor="account-username"
            hint="3–32 letters, numbers or underscores. Not an email address."
          >
            <Input
              id="account-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              maxLength={32}
              pattern="[A-Za-z0-9_]{3,32}"
              disabled={busy}
            />
          </Field>
          <Field label="Login password" htmlFor="account-password">
            <div className="password-input-wrap">
              <Input
                id="account-password"
                name="password"
                type={visible ? 'text' : 'password'}
                autoComplete={
                  mode !== 'login' ? 'new-password' : 'current-password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode !== 'login' ? 15 : 1}
                maxLength={256}
                disabled={busy}
              />
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={
                  visible ? 'Hide login password' : 'Show login password'
                }
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </Field>
          {mode !== 'login' && (
            <>
              <Field
                label="Confirm login password"
                htmlFor="account-confirmation"
                hint="Use at least 15 characters. Long passphrases work well."
              >
                <Input
                  id="account-confirmation"
                  type={visible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  minLength={15}
                  maxLength={256}
                  disabled={busy}
                />
              </Field>
              <Field
                label={
                  mode === 'recover'
                    ? 'Login recovery code'
                    : 'Administrator or household invitation code'
                }
                htmlFor="account-invitation"
                hint={
                  mode === 'recover'
                    ? 'Your single-use code saved from Settings. Never enter a vault recovery key here.'
                    : 'Your private invitation link fills in this code. It works once for 24 hours.'
                }
              >
                <Input
                  id="account-invitation"
                  autoComplete="off"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  required
                  pattern="[A-Za-z0-9_-]{43}"
                  maxLength={43}
                  disabled={busy}
                />
              </Field>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? 'Please wait…'
              : mode === 'recover'
                ? 'Reset login password'
                : mode === 'register'
                  ? 'Create account'
                  : 'Sign in'}
            {!busy && <ArrowRight />}
          </Button>
        </form>
        <p className="auth-footer-note">
          Your login password authenticates the account; your master password
          unlocks the vault. If your login password and login recovery code are
          both lost, automatic account recovery is unavailable. No account reset
          can decrypt a vault whose master password and vault recovery key are
          both lost.
        </p>
      </section>
    </main>
  )
}
