import type { Sqlite } from '../database/connection.ts'
import type {
  StoredProfile,
  StoredVault,
  VaultProfile,
  Envelope,
} from '../../shared/client-vault.ts'
import { canonical, digest, DriveError } from './security.ts'
export type Snapshot =
  | {
      kind: 'personal'
      userId: string
      profile: StoredProfile
      vault: StoredVault
    }
  | {
      kind: 'household'
      vault: StoredVault
      members: { userId: string; joined: boolean }[]
    }
export type SnapshotSet = Record<string, Snapshot>
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)
function exact(
  value: unknown,
  names: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== names.sort().join('|')
  )
    throw new DriveError('DRIVE_SNAPSHOT_INVALID')
}
function bytes(value: unknown, length?: number) {
  if (typeof value !== 'string' || value.length > 900000)
    throw new DriveError('DRIVE_SNAPSHOT_INVALID')
  const data = Buffer.from(value, 'base64')
  if (
    data.toString('base64') !== value ||
    (length ? data.length !== length : data.length < 16)
  )
    throw new DriveError('DRIVE_SNAPSHOT_INVALID')
}
function envelope(value: Envelope) {
  exact(value, ['v', 'alg', 'nonce', 'ciphertext'])
  if (value.v !== 1 || value.alg !== 'XChaCha20-Poly1305')
    throw new DriveError('DRIVE_SNAPSHOT_INVALID')
  bytes(value.nonce, 24)
  bytes(value.ciphertext)
}
export function validateSnapshot(
  namespace: string,
  value: Snapshot,
  users: Set<string>,
) {
  if (value.kind === 'personal') {
    exact(value, ['kind', 'userId', 'profile', 'vault'])
    if (
      !id(value.userId) ||
      !users.has(value.userId) ||
      namespace !== 'personal:' + value.userId ||
      value.vault.id !== namespace ||
      value.vault.ownerId !== value.userId ||
      value.vault.scope !== 'personal' ||
      value.vault.check !== null
    )
      throw new DriveError('DRIVE_SNAPSHOT_INVALID')
    exact(value.profile, ['revision', 'data'])
    if (!validRevision(value.profile.revision))
      throw new DriveError('DRIVE_SNAPSHOT_INVALID')
    const profile = value.profile.data
    exact(profile, ['v', 'kdf', 'master', 'recovery', 'keyring'])
    exact(profile.kdf, ['name', 'memory', 'iterations', 'parallelism', 'salt'])
    if (
      profile.v !== 1 ||
      profile.kdf.name !== 'Argon2id' ||
      profile.kdf.memory !== 65536 ||
      profile.kdf.iterations !== 3 ||
      profile.kdf.parallelism !== 1
    )
      throw new DriveError('DRIVE_SNAPSHOT_INVALID')
    bytes(profile.kdf.salt, 16)
    envelope(profile.master)
    envelope(profile.recovery)
    envelope(profile.keyring)
  } else if (value.kind === 'household') {
    exact(value, ['kind', 'vault', 'members'])
    if (
      namespace !== 'household:' + value.vault.id ||
      !id(value.vault.id) ||
      value.vault.scope !== 'shared' ||
      !value.vault.check ||
      !Array.isArray(value.members) ||
      value.members.length > 2
    )
      throw new DriveError('DRIVE_SNAPSHOT_INVALID')
    envelope(value.vault.check)
    const seen = new Set<string>()
    for (const member of value.members) {
      exact(member, ['userId', 'joined'])
      if (
        !id(member.userId) ||
        !users.has(member.userId) ||
        seen.has(member.userId) ||
        typeof member.joined !== 'boolean'
      )
        throw new DriveError('DRIVE_SNAPSHOT_INVALID')
      seen.add(member.userId)
    }
    if (
      !value.members.some(
        (member) => member.userId === value.vault.ownerId && member.joined,
      )
    )
      throw new DriveError('DRIVE_SNAPSHOT_INVALID')
  } else throw new DriveError('DRIVE_SNAPSHOT_INVALID')
  exact(value.vault, ['id', 'scope', 'ownerId', 'revision', 'payload', 'check'])
  if (!users.has(value.vault.ownerId) || !validRevision(value.vault.revision))
    throw new DriveError('DRIVE_SNAPSHOT_INVALID')
  envelope(value.vault.payload)
}
function validRevision(value: number) {
  return (
    Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER
  )
}
export function exportSnapshots(db: Sqlite): SnapshotSet {
  return db.transaction(() => {
    const result: SnapshotSet = {}
    const profiles = db
      .prepare(
        'SELECT user_id,revision,data FROM client_vault_profiles ORDER BY user_id',
      )
      .all() as { user_id: string; revision: number; data: string }[]
    const vaults = db
      .prepare('SELECT * FROM client_vaults ORDER BY id')
      .all() as {
      id: string
      scope: 'personal' | 'shared'
      owner_id: string
      revision: number
      payload: string
      key_check: string | null
    }[]
    for (const row of vaults) {
      const vault: StoredVault = {
        id: row.id,
        scope: row.scope,
        ownerId: row.owner_id,
        revision: row.revision,
        payload: JSON.parse(row.payload) as Envelope,
        check: row.key_check ? (JSON.parse(row.key_check) as Envelope) : null,
      }
      if (row.scope === 'personal') {
        const profile = profiles.find((value) => value.user_id === row.owner_id)
        if (!profile) throw new DriveError('DRIVE_LOCAL_DATA_INVALID')
        result['personal:' + row.owner_id] = {
          kind: 'personal',
          userId: row.owner_id,
          profile: {
            revision: profile.revision,
            data: JSON.parse(profile.data) as VaultProfile,
          },
          vault,
        }
      } else
        result['household:' + row.id] = {
          kind: 'household',
          vault,
          members: (
            db
              .prepare(
                'SELECT user_id,joined FROM client_vault_members WHERE vault_id=? ORDER BY user_id',
              )
              .all(row.id) as { user_id: string; joined: number }[]
          ).map((value) => ({
            userId: value.user_id,
            joined: Boolean(value.joined),
          })),
        }
    }
    return result
  })()
}
export const hashes = (set: SnapshotSet) =>
  Object.fromEntries(
    Object.entries(set).map(([namespace, value]) => [namespace, digest(value)]),
  )
/** Called only inside the final transaction, with a matching captured local fingerprint. */
export function importSnapshots(db: Sqlite, set: SnapshotSet): boolean {
  const old = exportSnapshots(db)
  if (canonical(old) === canonical(set)) return false
  const users = new Set(
    (db.prepare('SELECT id FROM users').all() as { id: string }[]).map(
      (row) => row.id,
    ),
  )
  if (Object.keys(set).length > 3)
    throw new DriveError('DRIVE_SNAPSHOT_INVALID')
  for (const [namespace, value] of Object.entries(set))
    validateSnapshot(namespace, value, users)
  // A missing namespace never means deletion. Preserve it and raise a conflict upstream.
  for (const namespace of Object.keys(old))
    if (!set[namespace]) throw new DriveError('DRIVE_NAMESPACE_MISSING')
  const households = Object.values(set).filter(
    (value) => value.kind === 'household',
  )
  if (households.length > 1) throw new DriveError('DRIVE_SNAPSHOT_INVALID')
  for (const value of Object.values(set)) {
    if (value.kind === 'personal')
      db.prepare(
        'INSERT INTO client_vault_profiles(user_id,revision,data) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,data=excluded.data',
      ).run(
        value.userId,
        value.profile.revision,
        JSON.stringify(value.profile.data),
      )
    const vault = value.vault
    const existing = db
      .prepare('SELECT id FROM client_vaults WHERE scope=? AND owner_id=?')
      .get(vault.scope, vault.ownerId) as { id: string } | undefined
    if (existing && existing.id !== vault.id)
      throw new DriveError('DRIVE_VAULT_IDENTITY_MISMATCH')
    db.prepare(
      'INSERT INTO client_vaults(id,scope,owner_id,revision,payload,key_check) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,key_check=excluded.key_check',
    ).run(
      vault.id,
      vault.scope,
      vault.ownerId,
      vault.revision,
      JSON.stringify(vault.payload),
      vault.check ? JSON.stringify(vault.check) : null,
    )
    if (value.kind === 'household') {
      const owner = db
        .prepare("SELECT 1 FROM users WHERE id=? AND role='administrator'")
        .get(vault.ownerId)
      if (!owner) throw new DriveError('DRIVE_SNAPSHOT_INVALID')
      db.prepare('DELETE FROM client_vault_members WHERE vault_id=?').run(
        vault.id,
      )
      for (const member of value.members)
        db.prepare(
          'INSERT INTO client_vault_members(vault_id,user_id,joined) VALUES(?,?,?)',
        ).run(vault.id, member.userId, Number(member.joined))
    }
  }
  // Also prevents revision ABA/stale unlocked keys after an explicit older-copy resolution.
  db.prepare('DELETE FROM sessions').run()
  return true
}
