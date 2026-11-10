import { AuthApiError } from '../auth/api'
import type { VaultApi } from './engine'
export function createVaultApi(csrfToken: string): VaultApi {
  return async (path, body) => {
    const response = await fetch('/api/vault/' + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: body
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
        : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      if (response.status === 401)
        throw new AuthApiError(401, 'AUTHENTICATION_REQUIRED')
      if (response.status === 409)
        throw new Error(
          'Vault changed in another tab. Lock and unlock to reload before trying again.',
        )
      if (response.status === 403)
        throw new Error(
          'This account is not authorised for that vault operation.',
        )
      throw new Error(
        'Vault request failed. Check the connection and try again; never reset a missing vault.',
      )
    }
    return response.json()
  }
}
