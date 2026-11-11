import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { check, ProofError } from './errors.mjs'
export const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const FULL_SCOPE = 'https://www.googleapis.com/auth/drive'
export function validateConfiguration(value) {
  check(
    value &&
      typeof value === 'object' &&
      Object.keys(value).every((k) =>
        ['clientId', 'scope', 'allowRestrictedDriveScope'].includes(k),
      ),
  )
  check(
    typeof value.clientId === 'string' &&
      value.clientId.length < 512 &&
      /^[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(
        value.clientId,
      ),
    'PROOF_DEVELOPER_GOOGLE_CLIENT_REQUIRED',
  )
  const scope = value.scope ?? FILE_SCOPE
  check(
    scope === FILE_SCOPE ||
      (scope === FULL_SCOPE && value.allowRestrictedDriveScope === true),
    'PROOF_SCOPE_NOT_APPROVED',
  )
  return {
    clientId: value.clientId,
    scope,
    ...(scope === FULL_SCOPE ? { allowRestrictedDriveScope: true } : {}),
  }
}
export async function readResponse(response, max = 2000000) {
  check(!response.redirected, 'PROOF_REDIRECT_REJECTED')
  check(
    Number(response.headers.get('content-length') ?? 0) <= max,
    'PROOF_RESPONSE_LIMIT',
  )
  const reader = response.body?.getReader()
  check(reader, 'PROOF_RESPONSE_INVALID')
  let size = 0
  const parts = []
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      check(size <= max, 'PROOF_RESPONSE_LIMIT')
      parts.push(Buffer.from(part.value))
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
export async function nativeAuthorization(
  configuration,
  { open, fetch: run = fetch, pickFolders = [], timeout = 300000, signal },
) {
  const { clientId, scope } = validateConfiguration(configuration),
    state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url')
  check(
    pickFolders.length <= 3 &&
      pickFolders.every((id) => /^[A-Za-z0-9_-]{10,150}$/.test(id)),
  )
  check(!signal?.aborted, 'PROOF_GOOGLE_AUTH_CANCELLED')
  const server = createServer()
  let timer,
    abort,
    settled = false
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const redirect =
    'http://127.0.0.1:' + server.address().port + '/oauth-callback'
  const result = new Promise((resolve, reject) => {
    abort = () => reject(new ProofError('PROOF_GOOGLE_AUTH_CANCELLED'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    timer = setTimeout(
      () => reject(new ProofError('PROOF_GOOGLE_CONSENT_TIMEOUT')),
      timeout,
    )
    server.on('request', (request, response) => {
      const url = new URL(request.url, redirect)
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Referrer-Policy', 'no-referrer')
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'",
      )
      if (
        settled ||
        request.method !== 'GET' ||
        request.headers.host !== '127.0.0.1:' + server.address().port ||
        url.pathname !== '/oauth-callback' ||
        url.searchParams.get('state') !== state
      ) {
        response.writeHead(400)
        response.end('Invalid authorization response.')
        return
      }
      settled = true
      const code = url.searchParams.get('code')
      response.end(
        'Google authorization received. Close this tab and return to the fictional Lockbox proof.',
      )
      if (url.searchParams.has('error') || !code || code.length > 4096)
        reject(new ProofError('PROOF_GOOGLE_CONSENT_DENIED'))
      else
        resolve({ code, picked: url.searchParams.get('picked_file_ids') ?? '' })
    })
  })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'false',
    prompt: 'consent select_account',
  }))
    url.searchParams.set(key, value)
  if (pickFolders.length && scope === FILE_SCOPE) {
    url.searchParams.set('trigger_onepick', 'true')
    url.searchParams.set('allow_folder_selection', 'true')
    url.searchParams.set('allow_multiple', 'true')
    url.searchParams.set('file_ids', pickFolders.join(','))
  }
  try {
    // Attach a rejection handler before opening the external browser.
    const [{ code, picked }] = await Promise.all([result, open(url.href)])
    if (pickFolders.length) {
      const selected = picked.split(',').filter(Boolean)
      check(
        pickFolders.every((id) => selected.includes(id)) &&
          selected.every((id) => pickFolders.includes(id)),
        'PROOF_GOOGLE_FOLDER_SELECTION_REQUIRED',
      )
    }
    const response = await run('https://oauth2.googleapis.com/token', {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15000),
    })
    const tokens = await readResponse(response, 65536)
    check(
      response.ok &&
        typeof tokens.access_token === 'string' &&
        (tokens.refresh_token === undefined ||
          typeof tokens.refresh_token === 'string') &&
        Number.isFinite(tokens.expires_in) &&
        tokens.expires_in > 0 &&
        typeof tokens.scope === 'string' &&
        tokens.scope
          .trim()
          .split(/\s+/)
          .every((value) => value === scope),
      'PROOF_GOOGLE_TOKEN_EXCHANGE_FAILED',
    )
    return {
      clientId,
      access: tokens.access_token,
      refresh: tokens.refresh_token ?? null,
      expires: Date.now() + tokens.expires_in * 1000,
      scope,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

export class GoogleConnection {
  constructor(configuration, tokens, save, run = fetch) {
    this.configuration = validateConfiguration(configuration)
    check(
      tokens.scope === undefined || tokens.scope === this.configuration.scope,
      'PROOF_GOOGLE_SCOPE_MISMATCH',
    )
    check(
      tokens.clientId === undefined ||
        tokens.clientId === this.configuration.clientId,
      'PROOF_GOOGLE_RECONNECT_REQUIRED',
    )
    this.tokens = tokens
    this.save = save
    this.fetch = run
    this.refreshing = null
  }
  async access(force = false) {
    check(this.tokens, 'PROOF_GOOGLE_NOT_CONNECTED')
    if (!force && this.tokens.expires > Date.now() + 60000)
      return this.tokens.access
    if (!this.refreshing)
      this.refreshing = (async () => {
        const response = await this.fetch(
            'https://oauth2.googleapis.com/token',
            {
              method: 'POST',
              redirect: 'error',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: this.configuration.clientId,
                refresh_token: this.tokens.refresh,
                grant_type: 'refresh_token',
              }),
              signal: AbortSignal.timeout(15000),
            },
          ),
          data = await readResponse(response, 65536)
        check(
          response.ok &&
            typeof data.access_token === 'string' &&
            Number.isFinite(data.expires_in) &&
            data.expires_in > 0 &&
            (data.scope === undefined ||
              (typeof data.scope === 'string' &&
                data.scope
                  .trim()
                  .split(/\s+/)
                  .every((value) => value === this.configuration.scope))) &&
            (data.refresh_token === undefined ||
              typeof data.refresh_token === 'string'),
          'PROOF_GOOGLE_RECONNECT_REQUIRED',
        )
        const previous = this.tokens
        this.tokens = {
          ...this.tokens,
          scope: this.configuration.scope,
          clientId: this.configuration.clientId,
          access: data.access_token,
          refresh: data.refresh_token ?? this.tokens.refresh,
          expires: Date.now() + data.expires_in * 1000,
        }
        try {
          this.save(this.tokens)
        } catch (error) {
          this.tokens = previous
          throw error
        }
        return this.tokens.access
      })().finally(() => {
        this.refreshing = null
      })
    return this.refreshing
  }
}
