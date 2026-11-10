import type { EncryptedVaultDocument } from '../../shared/vault-storage.ts'

/** Internal backend port; only accepts keys resolved from authorised server metadata. */
export interface EncryptedObjectStore {
  /** App-generated immutable object ID. Never an arbitrary caller-supplied Drive ID. */
  create(
    namespace: string,
    document: EncryptedVaultDocument,
    mutationId: string,
  ): Promise<{ objectId: string }>
  read(namespace: string, objectId: string): Promise<EncryptedVaultDocument>
  /** Retention cleanup only, after a committed Lockbox tombstone. */
  trash(namespace: string, objectId: string): Promise<void>
}
export interface VaultRevisionRegistry {
  /** Durable atomic operation. A conflict must not silently overwrite another revision. */
  compareAndSwap(input: {
    vaultId: string
    expectedRevision: string | null
    nextRevision: string
    objectId: string | null
    mutationId: string
  }): Promise<'committed' | 'conflict' | 'already-committed'>
}
