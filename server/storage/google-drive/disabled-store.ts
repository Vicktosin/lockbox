import type { EncryptedObjectStore } from '../contracts.ts'

export class DriveIntegrationNotReadyError extends Error {
  readonly code = 'DRIVE_INTEGRATION_NOT_READY'
  constructor() {
    super(
      'Drive access is disabled until Lockbox authentication, authorization, reviewed encryption and server OAuth/token storage are implemented.',
    )
    this.name = 'DriveIntegrationNotReadyError'
  }
}
/**
 * Deliberate fail-closed adapter. No SDK, fetch, tokens, encryption claims or uploads.
 * There is no env flag that can enable it. Replace only after the documented gates.
 */
export class DisabledGoogleDriveStore implements EncryptedObjectStore {
  create(): ReturnType<EncryptedObjectStore['create']> {
    return Promise.reject(new DriveIntegrationNotReadyError())
  }
  read(): ReturnType<EncryptedObjectStore['read']> {
    return Promise.reject(new DriveIntegrationNotReadyError())
  }
  trash(): ReturnType<EncryptedObjectStore['trash']> {
    return Promise.reject(new DriveIntegrationNotReadyError())
  }
}
