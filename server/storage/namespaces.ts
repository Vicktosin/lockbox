/** Server-owned metadata read from a future trusted registry after authentication. */
export type VaultRegistration = {
  householdId: string
  vaultId: string
} & ({ kind: 'personal'; ownerId: string } | { kind: 'shared' })

/** Logical prefixes, not Drive paths or ACLs. Use opaque server-generated IDs. */
export function vaultNamespace(vault: VaultRegistration): string {
  for (const id of [
    vault.householdId,
    vault.vaultId,
    ...(vault.kind === 'personal' ? [vault.ownerId] : []),
  ]) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new Error('Invalid opaque namespace identifier.')
  }
  const prefix = `households/${vault.householdId}`
  return vault.kind === 'personal'
    ? `${prefix}/personal/${vault.ownerId}/${vault.vaultId}`
    : `${prefix}/shared/${vault.vaultId}`
}
