/** Server-only environment reader. Never import this module from src/ or shared/. */
export interface BackendConfig {
  port: number
  driveFolderId: string | null
  oauth: {
    clientId: string | null
    clientSecretRef: string | null
    redirectUri: string | null
    scopes: readonly ['openid', 'https://www.googleapis.com/auth/drive.file']
  }
  tokenStoreRef: string | null
  metadataStoreRef: string | null
}
export function loadBackendConfig(
  environment: Record<string, string | undefined>,
): BackendConfig {
  const read = (name: string) => environment[name]?.trim() || null
  const portValue = read('LOCKBOX_BACKEND_PORT') ?? '8787'
  const port = Number(portValue)
  if (
    !/^\d+$/.test(portValue) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('LOCKBOX_BACKEND_PORT must be between 1 and 65535.')
  const folderId = read('GOOGLE_DRIVE_FOLDER_ID')
  if (folderId && !/^[a-zA-Z0-9_-]+$/.test(folderId))
    throw new Error(
      'GOOGLE_DRIVE_FOLDER_ID must be a folder ID, not a URL. This does not verify permissions.',
    )
  return {
    port,
    driveFolderId: folderId,
    oauth: {
      clientId: read('GOOGLE_OAUTH_CLIENT_ID'),
      clientSecretRef: read('GOOGLE_OAUTH_CLIENT_SECRET_REF'),
      redirectUri: read('GOOGLE_OAUTH_REDIRECT_URI'),
      scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
    },
    tokenStoreRef: read('LOCKBOX_TOKEN_STORE_REF'),
    metadataStoreRef: read('LOCKBOX_METADATA_STORE_REF'),
  }
}
