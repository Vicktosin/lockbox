export interface Account {
  id: string
  username: string
  role: 'administrator' | 'member'
}
export interface AccountSession {
  user: Account
  csrfToken: string
}
export interface AccountDevice {
  id: string
  device: string
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  current: boolean
}
export class AuthApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
  }
}
export async function authRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; csrfToken?: string } = {},
): Promise<T> {
  const response = await fetch('/api/auth/' + path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new AuthApiError(
      response.status,
      typeof data.code === 'string' ? data.code : 'REQUEST_FAILED',
    )
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
export function accountError(error: unknown) {
  if (error instanceof AuthApiError) {
    if (error.code === 'INVALID_CREDENTIALS')
      return 'Username or password is incorrect.'
    if (error.code === 'RECOVERY_FAILED')
      return 'Recovery could not be completed. Check your username and login recovery code.'
    if (error.code === 'REGISTRATION_NOT_AVAILABLE')
      return 'Registration could not be completed. Check the username and invitation code.'
    if (error.code === 'PASSWORD_CONFIRMATION_MISMATCH')
      return 'The passwords do not match.'
    if (error.code === 'INVALID_REGISTRATION_INPUT')
      return 'Use a password of 15–128 characters, at most 512 UTF-8 bytes.'
    if (error.status === 429)
      return 'Too many attempts. Please wait before trying again.'
    if (error.status === 401)
      return 'Your session has ended. Please sign in again.'
    if (error.status === 403)
      return 'This request was blocked. Refresh the page and try again.'
    if (error.status === 400) return 'Check the form fields and try again.'
  }
  return 'Unable to reach the account service. Check that the backend is running, then try again.'
}
