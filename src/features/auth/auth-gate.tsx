import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { VaultGate } from '@/features/vault/vault-gate'
import { AuthScreen } from './auth-screen'
import {
  authRequest,
  accountError,
  AuthApiError,
  type AccountSession,
} from './api'

export function AuthGate() {
  const [session, setSession] = useState<AccountSession | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    let live = true
    async function refresh() {
      const attempt = ++generation.current
      try {
        const value = await authRequest<AccountSession>('me')
        if (live && attempt === generation.current) {
          setSession(value)
          setError('')
        }
      } catch (reason) {
        if (live && attempt === generation.current) {
          if (reason instanceof AuthApiError && reason.status === 401) {
            setSession(null)
            setError('')
          } else setError(accountError(reason))
        }
      } finally {
        if (live && attempt === generation.current) setLoading(false)
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      live = false
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [revision])
  const signedOut = useCallback(() => {
    generation.current++
    setSession(null)
    setLoading(false)
    setError('')
    setNotice('You have been signed out.')
  }, [])
  const expired = useCallback(() => {
    generation.current++
    setSession(null)
    setLoading(false)
    setError('')
    setNotice('Your session has ended. Please sign in again.')
  }, [])
  async function logout() {
    if (!session) return
    try {
      await authRequest('logout', {
        method: 'POST',
        csrfToken: session.csrfToken,
      })
      signedOut()
    } catch (reason) {
      if (reason instanceof AuthApiError && reason.status === 401) signedOut()
      else setError(accountError(reason))
    }
  }
  if (loading)
    return (
      <main className="auth-loading" role="status">
        Opening your Lockbox account…
      </main>
    )
  if (!session)
    return (
      <AuthScreen
        notice={notice}
        serviceError={error}
        onRetry={() => setRevision((v) => v + 1)}
        onAuthenticated={(value) => {
          generation.current++
          setSession(value)
          setError('')
          setNotice('')
        }}
      />
    )
  return (
    <>
      {error && (
        <div className="account-connection-error" role="alert">
          {error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry
          </Button>
        </div>
      )}
      <VaultGate
        key={session.user.id}
        session={session}
        onLogout={() => void logout()}
        onSignedOut={signedOut}
        onExpired={expired}
      />
    </>
  )
}
