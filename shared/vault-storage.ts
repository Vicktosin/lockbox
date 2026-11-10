/** Provider-neutral design contracts, not a production wire format or encryption implementation. */
export type VaultDescriptor = { id: string } & (
  { kind: 'personal'; ownerId: string } | { kind: 'shared'; ownerId?: never }
)

/**
 * Must be produced by the future reviewed client encryption boundary.
 * A TypeScript label cannot prove bytes are encrypted; this is deliberately not
 * accepted by any running upload endpoint in the current scaffold.
 */
export interface EncryptedVaultDocument {
  format: 'lockbox.encrypted-vault'
  formatVersion: number
  /** Complete, opaque encrypted container including its authenticated header. */
  bytes: Uint8Array
}
export interface VaultSnapshot {
  vaultId: string
  /** Lockbox revision, not a Google file ID or Drive version. */
  revision: string
  document: EncryptedVaultDocument
}
export interface WriteCondition {
  /** null means create only; an existing vault requires its current revision. */
  expectedRevision: string | null
  /** Stable across a retry of the same write. */
  mutationId: string
}
export interface DeleteCondition {
  expectedRevision: string
  mutationId: string
}
export interface VaultChange {
  vaultId: string
  revision: string
  deleted: boolean
}
export interface ChangeBatch {
  changes: readonly VaultChange[]
  /** Opaque, user-scoped Lockbox cursor; never a raw Drive change token. */
  nextCursor: string
  hasMore: boolean
}
/** Future frontend port. Implement through the Lockbox backend, never the Drive SDK. */
export interface VaultStorage {
  listVaults(): Promise<readonly VaultDescriptor[]>
  read(vaultId: string): Promise<VaultSnapshot | null>
  write(
    vaultId: string,
    document: EncryptedVaultDocument,
    condition: WriteCondition,
  ): Promise<VaultSnapshot>
  remove(vaultId: string, condition: DeleteCondition): Promise<void>
  changes(cursor?: string): Promise<ChangeBatch>
}
