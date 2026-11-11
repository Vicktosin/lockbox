import type { VaultApi } from '@/features/vault/engine'
import type { VaultState } from '../../../shared/client-vault'
export type NativeStatus = {
  identityUnlocked: boolean
  stateToken: string
  pendingChanges: number
  role: 'owner' | 'partner'
  accountId: string
  fingerprint: string
  google: { emailAddress: string } | null
  googleConfigured: boolean
  googleTestMode: boolean
  liveSyncAllowed: boolean
  googleAuthorising: boolean
  securityBlockers: string[]
  googleConnected: boolean
  configuredFolders: boolean
  householdApproved: boolean
  lastSync: number | null
  lastError: string
  scope: string
  conflicts: { personal: string[]; household: string[] }
}
declare global {
  interface Window {
    lockboxProof: {
      request: <T = unknown>(action: string, payload?: unknown) => Promise<T>
    }
  }
}
const errors: Record<string, string> = {
  PROOF_GOOGLE_RATE_LIMITED:
    'Google is limiting requests. Encrypted changes stay queued and will retry; broader permissions are not needed.',
  PROOF_GOOGLE_TEMPORARY_ERROR:
    'Google is temporarily unavailable. Local edits are safe and queued for retry.',
  PROOF_LIVE_VAULT_SYNC_BLOCKED:
    'Live uploads from existing vaults are blocked by unfinished security requirements. Use a separate fictional Google test profile.',
  PROOF_PROFILE_MODE_MISMATCH:
    'This vault, invitation or backup belongs to a different application mode. Existing data was not imported.',
  PROOF_GOOGLE_FOLDER_SELECTION_REQUIRED:
    'Select both requested test folders in Google Picker. No broader Drive permission was requested.',
  PROOF_GOOGLE_AUTH_CANCELLED:
    'Google connection was cancelled. No new connection was saved.',
  PROOF_GOOGLE_AUTH_IN_PROGRESS:
    'A Google approval is already open. Finish or cancel it before retrying.',
  PROOF_GOOGLE_DRIVE_API_NOT_ENABLED:
    'The developer must enable Drive API for the registered Google application. Do not request broader file permissions.',
  PROOF_VAULT_LOCKED: 'Your vault locked. Unlock it to continue.',
  PROOF_SYNC_BUSY:
    'Synchronisation is active. Wait for it to finish before saving.',
  PROOF_NETWORK_UNAVAILABLE:
    'You are offline. Encrypted local changes are retained and will retry later.',
  PROOF_CONFLICT_CHANGED:
    'The versions changed. Load encrypted history again before choosing.',
  PROOF_SYNC_CONFLICT:
    'Conflicting versions are retained. Review them in Settings.',
  PROOF_REVISION_CONFLICT:
    'The vault changed. Refresh it and review any conflicts before retrying.',
  PROOF_BACKUP_PRIVATE_LOCATION_REQUIRED:
    'Choose a private backup folder outside website, source-control and application installation folders.',
  PROOF_BACKUP_ROLE_MISMATCH:
    'This backup belongs to the other household role. Choose the matching owner or partner installation first.',
  PROOF_BACKUP_INVALID:
    'This backup is damaged or unsupported. The existing vault was not replaced.',
  PROOF_BACKUP_REQUIRED: 'Choose an encrypted backup first.',
  PROOF_RESTORE_REQUIRES_EMPTY_PROFILE:
    'Restore requires an empty installation. Existing vaults cannot be overwritten.',
  PROOF_RECOVERY_CONFLICT_REVIEW_REQUIRED:
    'This backup contains Personal conflicts. Restore with its original master password and review them before changing recovery settings.',
  PROOF_HISTORY_LIMIT:
    'This preview reached its encrypted history limit. Export a backup and contact the maintainer; no history was discarded.',
  PROOF_GOOGLE_SCOPE_MISMATCH:
    'Google permissions do not match this installation. Reconnect using the configured permission.',
  PROOF_GOOGLE_RECONNECT_REQUIRED:
    'Google authorisation expired or was revoked. Reconnect your own Google account.',
  PROOF_GOOGLE_FOLDER_PERMISSION_REQUIRED:
    'Google has not authorised these vault files. Authorise the shared folders and retry.',
  PROOF_GOOGLE_FOLDER_PERMISSION_CHANGED:
    'The Drive folder permissions changed. Synchronisation stopped to protect your vault.',
  PROOF_DEVELOPER_GOOGLE_CLIENT_REQUIRED:
    'The Lockbox developer must register the Google application first. You do not need to configure Google Cloud.',
  PROOF_CLIPBOARD_CLEAR_BLOCKED:
    'Clipboard clearing was blocked. Clear it manually; clipboard history can retain copies.',
}
export function nativeErrorMessage(value: string) {
  return (
    errors[value] ??
    (value.startsWith('PROOF_')
      ? 'The operation could not complete safely. Lock and unlock to check the local vault; never reset it to hide an error.'
      : value)
  )
}
export async function request<T>(
  action: string,
  payload?: unknown,
): Promise<T> {
  try {
    return await window.lockboxProof.request<T>(action, payload)
  } catch (error) {
    const code =
      error instanceof Error ? error.message : 'PROOF_OPERATION_FAILED'
    throw Object.assign(new Error(nativeErrorMessage(code)), {
      code,
      ...(code === 'PROOF_VAULT_LOCKED' ? { status: 401 } : {}),
    })
  }
}
export const api: VaultApi = (path, body) =>
  request<VaultState>('api', { path, ...(body === undefined ? {} : { body }) })
