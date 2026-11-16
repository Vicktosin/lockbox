import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AccountSession } from '../auth/api'
import {
  beginGoogleSignIn,
  completeGoogleSignIn,
  hasGoogleRedirectResult,
  prepareGoogleSignIn,
  type GooglePublicConfig,
  type GoogleWebSession,
} from './google-auth'
import { GoogleDriveSetup } from './google-drive-setup'
import { VaultGate } from '../vault/vault-gate'

export function GoogleAuthGate() {
  const [config, setConfig] = useState<GooglePublicConfig | null>(null)
  const [google, setGoogle] = useState<GoogleWebSession | null>(null)
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [configLoading, setConfigLoading] = useState(true)

  useEffect(() => {
    // Google OAuth origins are exact: http://localhost:3000 is authorized,
    // http://127.0.0.1:3000 is not. Move loopback-IP visits to localhost so
    // Google does not reject the sign-in redirect for an unregistered origin.
    const { hostname, protocol, port, pathname, search, hash } = window.location
    if (hostname === '127.0.0.1' || hostname === '[::1]') {
      window.location.replace(
        `${protocol}//localhost${port ? ':' + port : ''}${pathname}${search}${hash}`,
      )
      return
    }
    let active = true
    void prepareGoogleSignIn()
      .then(async (value) => {
        if (!active) return
        setConfig(value)
        setError('')
        if (!hasGoogleRedirectResult()) return
        setBusy(true)
        try {
          const session = await completeGoogleSignIn(value)
          if (!active) return
          setGoogle(session)
          setFolder(null)
        } finally {
          if (active) setBusy(false)
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Unable to prepare Google sign-in.',
          )
      })
      .finally(() => {
        if (active) setConfigLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    // Returning with the browser Back button from Google restores this page
    // from cache with the button still busy; reset it.
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  const onFolderReady = useCallback(
    (value: { id: string; name: string }) =>
      setFolder((current) =>
        current?.id === value.id && current.name === value.name
          ? current
          : value,
      ),
    [],
  )

  useEffect(() => {
    if (!google) return
    const remaining = google.expiresAt - Date.now()
    const timer = setTimeout(
      () => {
        setGoogle(null)
        setFolder(null)
        setError('Google access expired. Sign in again to unlock your vault.')
      },
      Math.max(remaining, 0),
    )
    return () => clearTimeout(timer)
  }, [google])

  const session = useMemo<AccountSession | null>(() => {
    if (!google || !folder) return null
    return {
      user: {
        id: google.identity.id,
        username: google.identity.email,
        role: 'administrator',
      },
      csrfToken: '',
      driveToken: google.accessToken,
      driveFolderId: folder.id,
      google,
    }
  }, [google, folder])

  function signIn() {
    if (!config || busy) return
    setError('')
    try {
      setBusy(true)
      beginGoogleSignIn(config)
    } catch (reason) {
      setBusy(false)
      setError(
        reason instanceof Error ? reason.message : 'Google sign-in failed.',
      )
    }
  }

  const signOut = useCallback(() => {
    setGoogle(null)
    setFolder(null)
    setError('')
  }, [])

  if (session)
    return (
      <VaultGate
        key={session.user.id + ':' + session.driveFolderId}
        session={session}
        onLogout={signOut}
        onExpired={signOut}
        onDriveFolderChange={onFolderReady}
      />
    )

  if (google)
    return (
      <main className="auth-page vault-access">
        <section className="auth-intro">
          <span className="brand-mark">
            <LockKeyhole />
          </span>
          <span className="eyebrow">GOOGLE DRIVE</span>
          <h1>Choose your storage.</h1>
          <p>
            Your personal vault stays in private Drive app data. A shared
            Household vault uses a folder you choose and share.
          </p>
          <p className="field-hint">
            Only encrypted vault files are stored. Lockbox does not keep a
            separate account database or save Google access tokens.
          </p>
        </section>
        <GoogleDriveSetup
          session={google}
          onFolderReady={onFolderReady}
          onSignOut={signOut}
        />
      </main>
    )

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <a className="auth-brand" href="#/dashboard">
          <span className="brand-mark">
            <LockKeyhole size={22} />
          </span>
          lockbox<span className="brand-dot">.</span>
        </a>
        <span className="eyebrow">A PRIVATE SPACE FOR YOUR HOUSEHOLD</span>
        <h1>
          Your vault.
          <br />
          Your Drive.
        </h1>
        <p>
          Sign in with Google to access your encrypted personal vault and the
          Household vault you share.
        </p>
        <div className="auth-security-note">
          <ShieldCheck size={19} />
          <span>
            Vault contents are encrypted on this device before they are saved.
            Your master password is never sent to Google or Lockbox.
          </span>
        </div>
      </section>
      <section className="panel auth-form-panel" aria-labelledby="auth-heading">
        <h2 id="auth-heading">Continue with Google</h2>
        <p className="auth-description">
          Lockbox does not create or store a separate account password. Google
          identifies you; your master password independently unlocks your
          encrypted vault.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!error && configLoading && (
          <p role="status">Preparing secure Google sign-in…</p>
        )}
        <Button
          type="button"
          disabled={!config || busy || configLoading}
          onClick={() => signIn()}
          className="w-full"
        >
          {busy ? 'Waiting for Google…' : 'Sign in with Google'}
          {!busy && <ArrowRight />}
        </Button>
        <p className="auth-footer-note">
          Google access is held in memory only and expires automatically. You
          may need to sign in again after closing or refreshing this page.
        </p>
      </section>
    </main>
  )
}
