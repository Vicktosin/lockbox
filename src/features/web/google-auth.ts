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

function normalizeScope(scope: string) {
  return scope === 'https://www.googleapis.com/auth/userinfo.email'
    ? 'email'
    : scope
}

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
            reject(
              new Error(
                response.error === 'access_denied'
                  ? 'Google access was not approved (access_denied). Choose Allow on the Google consent screen.'
                  : `Google sign-in failed (${response.error ?? 'no_access_token'}${response.error_description ? ': ' + response.error_description : ''}).`,
              ),
            )
            return
          }
          const granted = new Set(
            (response.scope ?? '')
              .split(/\s+/)
              .filter(Boolean)
              .map(normalizeScope),
          )
          const missing = requestedScopes.filter((scope) => !granted.has(scope))
          if (missing.length) {
            reject(
              new Error(
                missing.some((scope) => scope.includes('/auth/drive'))
                  ? 'Google Drive access was not granted. Sign in again and tick both Google Drive checkboxes on the consent screen ("See, edit, create and delete only the specific Google Drive files you use with this app" and "See, create and delete its own configuration data in your Google Drive").'
                  : `Google did not grant: ${missing.join(', ')}. Sign in again and allow all requested access.`,
              ),
            )
            return
          }
          resolve({
            accessToken: response.access_token,
            expiresAt: Date.now() + expiresIn * 1000,
          })
        },
        error_callback: (error) => {
          if (settled) return
          settled = true
          const message =
            error.type === 'popup_failed_to_open'
              ? 'The Google sign-in popup was blocked. Allow pop-ups for this site and try again.'
              : error.type === 'popup_closed'
                ? 'The Google sign-in popup closed before Google returned access (popup_closed). If the popup showed a Google error such as "Access blocked" or "Error 403: access_denied", that message is the cause: fix it in Google Cloud Console (OAuth consent screen / test users).'
                : `Google sign-in could not complete (${error.type ?? 'unknown'}).`
          reject(new Error(message))
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
