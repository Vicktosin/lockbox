export interface GoogleDriveIdentity {
  id: string
  email: string
}

export function readBearer(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const match = /^Bearer ([\x21-\x7E]{20,4096})$/.exec(authorization)
  if (!match) throw new GoogleHttpError(401, 'GOOGLE_SIGN_IN_REQUIRED')
  return match[1]
}

export class GoogleHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function assertSameOrigin(request: Request, mutation = false) {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (
    (mutation && origin !== new URL(request.url).origin) ||
    (origin !== null && origin !== new URL(request.url).origin) ||
    site === 'cross-site'
  )
    throw new GoogleHttpError(403, 'REQUEST_FORBIDDEN')
}

export async function googleRequest(
  token: string,
  url: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', 'Bearer ' + token)
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  return response
}

export async function verifyGoogleIdentity(
  token: string,
): Promise<GoogleDriveIdentity> {
  let response: Response
  try {
    response = await googleRequest(
      token,
      'https://openidconnect.googleapis.com/v1/userinfo',
    )
  } catch {
    throw new GoogleHttpError(502, 'GOOGLE_IDENTITY_UNAVAILABLE')
  }
  if (!response.ok) throw new GoogleHttpError(401, 'GOOGLE_SIGN_IN_REQUIRED')
  const value = (await response.json()) as {
    sub?: string
    email?: string
    email_verified?: boolean
  }
  if (
    typeof value.sub !== 'string' ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(value.sub) ||
    typeof value.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
    value.email.length > 320 ||
    value.email_verified !== true
  )
    throw new GoogleHttpError(401, 'GOOGLE_IDENTITY_INVALID')
  return { id: value.sub, email: value.email }
}

export async function driveError(response: Response) {
  await response.body?.cancel()
  if (response.status === 401)
    return new GoogleHttpError(401, 'GOOGLE_RECONNECT_REQUIRED')
  if (response.status === 403)
    return new GoogleHttpError(403, 'GOOGLE_DRIVE_PERMISSION_REQUIRED')
  if (response.status === 404)
    return new GoogleHttpError(404, 'DRIVE_FILE_NOT_FOUND')
  if (response.status === 409 || response.status === 412)
    return new GoogleHttpError(409, 'DRIVE_REVISION_CONFLICT')
  if (response.status === 429 || response.status >= 500)
    return new GoogleHttpError(502, 'GOOGLE_DRIVE_TEMPORARILY_UNAVAILABLE')
  return new GoogleHttpError(502, 'GOOGLE_DRIVE_REQUEST_FAILED')
}

export function googleErrorResponse(error: unknown) {
  const value =
    error instanceof GoogleHttpError
      ? error
      : new GoogleHttpError(500, 'REQUEST_FAILED')
  return Response.json(
    { code: value.code },
    {
      status: value.status,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
