import { AuthApiError, type AccountSession } from '../auth/api'
import type { VaultState } from '../../../shared/client-vault'
import type { VaultApi } from './engine'

export async function requestVault<T>(
  session: AccountSession,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!session.driveToken || !session.driveFolderId)
    throw new Error('Connect a Google Drive folder before opening the vault.')
  const response = await fetch('/api/vault/' + path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: 'Bearer ' + session.driveToken,
      'X-Lockbox-Drive-Folder': session.driveFolderId,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      code?: unknown
    }
    const code = typeof data.code === 'string' ? data.code : 'REQUEST_FAILED'
    if (response.status === 401)
      throw new AuthApiError(response.status, code)
    if (response.status === 409)
      throw new Error(
        'Drive contains a newer vault revision. Refresh the vault and review the current copy before saving again.',
      )
    if (response.status === 403)
      throw new Error(
        code === 'HOUSEHOLD_ACCESS_NOT_GRANTED'
          ? 'The Household owner must invite this Google account and share the Drive folder.'
          : 'Google Drive denied access. Check this account’s folder permissions.',
      )
    if (code === 'DRIVE_FILE_TOO_LARGE')
      throw new Error('This encrypted vault or its history exceeds the Drive file limit.')
    if (code === 'DRIVE_FOLDER_REQUIRED')
      throw new Error('Choose a Google Drive folder before opening the vault.')
    if (response.status >= 500)
      throw new Error(
        'Google Drive could not complete the request. Your unsaved change was not confirmed; refresh before retrying.',
      )
    throw new Error('The vault request was rejected (' + code + ').')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function createVaultApi(session: AccountSession): VaultApi {
  return <T = VaultState>(path: string, body?: unknown) =>
    requestVault<T>(session, path, body)
}
