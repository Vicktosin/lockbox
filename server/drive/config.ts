import { DriveError } from './security.ts'
export interface GoogleApplication {
  clientId: string
  clientSecret: string
  redirectUri: string
}
/** Deployment-owned confidential registration. Never read VITE_ settings or accept these through HTTP. */
export function loadGoogleApplication(
  environment: Record<string, string | undefined>,
  origin: string,
): GoogleApplication | null {
  const clientId = environment.LOCKBOX_GOOGLE_CLIENT_ID?.trim(),
    clientSecret = environment.LOCKBOX_GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId && !clientSecret) return null
  if (
    !clientId ||
    !clientSecret ||
    clientId.length > 512 ||
    clientSecret.length > 1024 ||
    /[\r\n]/.test(clientId + clientSecret)
  )
    throw new DriveError('DRIVE_APPLICATION_CONFIGURATION_INVALID')
  return { clientId, clientSecret, redirectUri: origin + '/api/drive/callback' }
}
