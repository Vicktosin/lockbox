# Authentication and client-vault data model

Phase 7: [current release validation](phase7-release-validation.md) records actual Chrome/Edge runtime and private Caddy evidence, internal fixes and outstanding live Google/UI/physical-device/systemd/independent-review gates. Historical phase statements are not present-release certification.

Phase 6 update: [Current release assessment and recovery rehearsal](phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Phase 5 update: [Recovery and production preparation](phase5-recovery-production.md) is the current authority for login recovery codes, complete encrypted backups, safe restoration, retained history and deployment templates. Older deferred-recovery/database-only descriptions below are historical where superseded. Live Google validation and independent review remain outstanding.

SQLite remains the single-host source of truth, with better-sqlite3, foreign keys, WAL, FULL durability, parameterized queries and short transactions. Existing migrations 0001/0002 are unchanged; additive 0003 adds ciphertext storage. No plaintext saved-credential or key table is introduced.

Phase 4 adds immutable migration 0004: drive_connection (encrypted token envelope/epoch/status/lease), drive_oauth_states (digest/session/expiry plus encrypted verifier), drive_checkpoints (head/content hashes), drive_objects (idempotent allocated file IDs), drive_commit_cache (versioned authenticated commits) and drive_conflicts (encrypted heads/approvals). Client profiles/keys/credential formats are unchanged. Startup performs encrypted-backup-protected upgrades; users do not run database commands. Restore clears all Google grants/attempts/sync metadata before activation.

| Table                                                           | Active purpose                                                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users                                                           | Stable IDs, display/canonical usernames, UNIQUE/CHECK canonical consistency, Argon2id PHC login hashes, administrator/member role, active/reset-required flags, reserved recovery contacts and timestamps |
| sessions                                                        | UNIQUE random-token digests, account FK, created/seen/idle/absolute expiry and bounded user-agent/device labels                                                                                           |
| account_tokens                                                  | Purpose-bound digest-only invitations with role/expiry/consumption; reset/verification purposes remain reserved                                                                                           |
| client_vault_profiles                                           | Account PK/FK, positive revision and versioned JSON containing fixed KDF metadata and encrypted master/recovery/keyring envelopes                                                                         |
| client_vaults                                                   | ID, Personal/Household scope, owner FK, positive revision, encrypted snapshot and Household-only encrypted key check                                                                                      |
| client_vault_members                                            | Vault/account composite PK/FKs and pending/joined status; each account is granted separately                                                                                                              |
| schema_migrations                                               | Immutable version/name/canonicalized SHA-256 checksum/application time                                                                                                                                    |
| app_metadata, encryption_key_checks                             | Existing database UUID/key binding; protected server keys stay outside SQLite                                                                                                                             |
| encrypted_payloads, credentials, folders, credential_visibility | Reserved Phase 1 schema/view retained, not used by the Phase 3 client engine                                                                                                                              |

No master password, decrypted root/vault key, recovery code, credential name/URL/username/password/notes/category/folder name is persisted in plaintext. Public account IDs, vault scope/owner IDs, revisions, KDF parameters/salts and ciphertext lengths remain visible.

## Ciphertext documents

Each Personal or Household snapshot contains a versioned credential/folder document, encrypted in the browser before any API request. Credentials carry random IDs, category, optional folder ID and timestamps inside ciphertext. Folder removal removes assignments and retains credentials. Decrypted validation bounds fields, permits HTTP(S) websites only, checks IDs/categories/folder scope and rejects malformed contents.

Limits: 500,000 decrypted bytes, 2,000 credentials and 128 folders per document; encrypted API bodies are capped at 1 MiB (2 MiB for atomic moves containing two snapshots). This is deliberate snapshot storage for two household users. No plaintext FTS/search index or staging table is used.

client_vault_profiles has one row per account; client_vaults has one Personal row per owner and one Household row globally, enforced by partial UNIQUE indexes. Membership FKs preserve consistency. No default accounts, keys or fixture records are seeded.

## Authorization

| Actor                                                        | Personal                              | Household                                                                                   |
| ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Authenticated owner with unlocked keys                       | Own read/write only                   | Joined members read/edit/delete/move all shared contents                                    |
| Other household account, including application administrator | No access                             | Only after explicit owner grant and successful client-key join                              |
| Household owner                                              | No override for another private vault | Create, grant, remove/rotate shared access                                                  |
| Pending member                                               | Own Personal access                   | Can retrieve encrypted check/snapshot to verify transferred key; cannot save before joining |
| Unauthenticated, inactive or reset-required user             | Denied                                | Denied                                                                                      |

The current shared document is collaborative, rather than the old reserved per-item owner-only deletion/move proposal. Only the Household owner manages membership. This simplifies the local scope without weakening an existing active credential API: none existed before Phase 3. Legacy credential.owner values serve display compatibility and are not authorization inputs.

## Transactions and races

Registration consumes invitations/inserts accounts atomically, preserving Phase 2 behavior. Snapshot writes require the expected revision and increment it. A stale save returns conflict without overwriting another writer. Cross-scope credential moves update both snapshots in one immediate transaction and roll back both if either revision is stale.

Profile rewraps require its revision. Household creation/join updates membership and the user's encrypted keyring together. Removal deletes membership, updates the owner's encrypted keyring and rotates the shared snapshot/check in one transaction with both expected revisions. Hashing/key derivation/encryption remain outside SQLite transactions.

The server validates ciphertext wire schemas and permissions, but cannot inspect or prove that arbitrary malicious clients submitted valid encrypted plaintext. Authorized accounts/server compromise can destroy or roll back opaque data; backups and independent review remain necessary. Authentication of vault context detects substitution/tampering, not complete-server rollback to an older valid database.

## Keys and restoration

See [Phase 3 key hierarchy](phase3-report.md). Server backup keys never become user master passwords or vault keys. Staged restore authenticates its outer archive, verifies migrations/integrity/key binding, removes sessions/tokens and sets account reset-required. Users must eventually validate inner vault decryption with their own master/recovery keys. Account-login recovery is deferred, so restored accounts remain blocked now; never clear the flag to bypass that missing feature.

[Operations](operations.md) · [account controls](authentication-security.md) · [architecture](architecture.md)
