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

// Sign-in uses Google's full-page OAuth 2.0 redirect (token response in the
// URL fragment) instead of a popup. Popups depend on window.opener surviving
// Google's pages, pop-up blockers and Cross-Origin-Opener-Policy, and fail as
// "popup_closed" when any of those interfere. A redirect has none of those
// dependencies. Google must list this site's origin with a trailing slash
// (for example https://lockbox-jet.vercel.app/) under Authorized redirect URIs.
const authEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
const pendingKey = 'lockbox.google.oauth'

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

export function googleRedirectUri() {
  return window.location.origin + '/'
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

export function prepareGoogleSignIn() {
  return loadGoogleConfig()
}

function randomState() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildGoogleAuthUrl(clientId: string, state: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'token',
    scope: requestedScopes.join(' '),
    include_granted_scopes: 'false',
    prompt: 'select_account consent',
    state,
  })
  return authEndpoint + '?' + params.toString()
}

/** Leaves the page and goes to Google. Returns only if navigation fails. */
export function beginGoogleSignIn(config: GooglePublicConfig) {
  if (!config.clientId) throw new Error('Google sign-in is not configured.')
  const state = randomState()
  try {
    sessionStorage.setItem(pendingKey, state)
  } catch {
    throw new Error(
      'This browser blocks session storage for this site, which Google sign-in needs. Allow site data and try again.',
    )
  }
  window.location.assign(buildGoogleAuthUrl(config.clientId, state))
}

/** True when the current URL is Google returning to this app. */
export function hasGoogleRedirectResult() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return (
    params.has('state') && (params.has('access_token') || params.has('error'))
  )
}

function takePendingState() {
  try {
    const value = sessionStorage.getItem(pendingKey)
    sessionStorage.removeItem(pendingKey)
    return value
  } catch {
    return null
  }
}

/** Reads Google's redirect response, removes it from the URL and verifies it. */
export async function completeGoogleSignIn(
  config: GooglePublicConfig,
): Promise<GoogleWebSession> {
  const params = new URLSearchParams(window.location.hash.slice(1))
  // Remove the token from the address bar and history immediately.
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  )
  const expected = takePendingState()
  const state = params.get('state')
  if (!expected || !state || state !== expected)
    throw new Error(
      'Google sign-in response did not match this browser session. Click Sign in with Google again.',
    )
  const error = params.get('error')
  if (error)
    throw new Error(
      error === 'access_denied'
        ? 'Google access was not approved (access_denied). Choose Allow on the Google consent screen.'
        : `Google sign-in failed (${error}${params.get('error_description') ? ': ' + params.get('error_description') : ''}).`,
    )
  const accessToken = params.get('access_token')
  const expiresIn = Number(params.get('expires_in'))
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new Error('Google did not return an access token.')
  const granted = new Set(
    (params.get('scope') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map(normalizeScope),
  )
  const missing = requestedScopes.filter((scope) => !granted.has(scope))
  if (missing.length)
    throw new Error(
      missing.some((scope) => scope.includes('/auth/drive'))
        ? 'Google Drive access was not granted. Sign in again and tick both Google Drive checkboxes on the consent screen.'
        : `Google did not grant: ${missing.join(', ')}. Sign in again and allow all requested access.`,
    )

  const response = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    {
      headers: { Authorization: 'Bearer ' + accessToken },
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
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    config,
  }
}
