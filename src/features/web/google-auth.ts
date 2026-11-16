export interface GooglePublicConfig {
  configured: boolean
  clientId: string | null
  apiKey: string | null
  appId: string | null
}

export interface GoogleIdentity {
  id: string
  email: string
}

export interface GoogleWebSession {
  identity: GoogleIdentity
  accessToken: string
  expiresAt: number
  config: GooglePublicConfig
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient(options: {
            client_id: string
            scope: string
            include_granted_scopes: boolean
            callback: (response: GoogleTokenResponse) => void
            error_callback: (error: { type?: string }) => void
          }): GoogleTokenClient
        }
      }
    }
  }
}

const requestedScopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
]

let identityScript: Promise<void> | null = null

async function loadIdentityScript() {
  if (window.google?.accounts?.oauth2) return
  if (!identityScript) {
    identityScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => {
        if (window.google?.accounts?.oauth2) resolve()
        else reject(new Error('Google sign-in did not initialize.'))
      }
      script.onerror = () => reject(new Error('Unable to load Google sign-in.'))
      document.head.append(script)
    }).catch((error: unknown) => {
      identityScript = null
      throw error
    })
  }
  await identityScript
}

export async function loadGoogleConfig(): Promise<GooglePublicConfig> {
  const response = await fetch('/api/google/config', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Google sign-in is not configured.')
  const value = (await response.json()) as GooglePublicConfig
  if (!value.configured || !value.clientId || !value.apiKey || !value.appId)
    throw new Error(
      'Google sign-in is not configured for this deployment. The maintainer must add the public Google OAuth and Picker settings.',
    )
  return value
}

export async function prepareGoogleSignIn() {
  const config = await loadGoogleConfig()
  await loadIdentityScript()
  return config
}

function requestGoogleToken(clientId: string) {
  return new Promise<{ accessToken: string; expiresAt: number }>(
    (resolve, reject) => {
      const oauth = window.google?.accounts?.oauth2
      if (!oauth) {
        reject(new Error('Google sign-in is unavailable.'))
        return
      }
      let settled = false
      const client = oauth.initTokenClient({
        client_id: clientId,
        scope: requestedScopes.join(' '),
        include_granted_scopes: false,
        callback: (response) => {
          if (settled) return
          settled = true
          const expiresIn = response.expires_in
          if (
            response.error ||
            typeof response.access_token !== 'string' ||
            typeof expiresIn !== 'number' ||
            !Number.isFinite(expiresIn) ||
            expiresIn <= 0
          ) {
            reject(new Error('Google access was not approved.'))
            return
          }
          const granted = new Set((response.scope ?? '').split(/\s+/))
          if (
            !requestedScopes.every((scope) => granted.has(scope)) ||
            [...granted].some(
              (scope) => scope && !requestedScopes.includes(scope),
            )
          ) {
            reject(
              new Error(
                'Google returned permissions that do not match this app.',
              ),
            )
            return
          }
          resolve({
            accessToken: response.access_token,
            expiresAt: Date.now() + expiresIn * 1000,
          })
        },
        error_callback: () => {
          if (settled) return
          settled = true
          reject(new Error('Google sign-in was cancelled or blocked.'))
        },
      })
      client.requestAccessToken({ prompt: 'select_account consent' })
    },
  )
}

export function signInWithGoogle(
  config: GooglePublicConfig,
): Promise<GoogleWebSession> {
  if (!config.clientId)
    return Promise.reject(new Error('Google sign-in is not configured.'))
  const tokenRequest = requestGoogleToken(config.clientId)
  return tokenRequest.then(async (token) => {
    const response = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: { Authorization: 'Bearer ' + token.accessToken },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      },
    )
    if (!response.ok)
      throw new Error('Google could not verify the signed-in account.')
    const value = (await response.json()) as {
      sub?: string
      email?: string
      email_verified?: boolean
    }
    if (
      typeof value.sub !== 'string' ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(value.sub) ||
      typeof value.email !== 'string' ||
      value.email.length > 320 ||
      value.email_verified !== true
    )
      throw new Error('Google returned an invalid account identity.')
    return {
      identity: { id: value.sub, email: value.email },
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      config,
    }
  })
}
