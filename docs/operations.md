# Key storage, database lifecycle and restoration

Phase 7: [current release validation](phase7-release-validation.md) records actual Chrome/Edge runtime and private Caddy evidence, internal fixes and outstanding live Google/UI/physical-device/systemd/independent-review gates. Historical phase statements are not present-release certification.

Phase 6 update: [Current release assessment and recovery rehearsal](phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Phase 5 update: [Recovery and production preparation](phase5-recovery-production.md) is the current authority for login recovery codes, complete encrypted backups, safe restoration, retained history and deployment templates. Older deferred-recovery/database-only descriptions below are historical where superseded. Live Google validation and independent review remain outstanding.

Phases 1–3 implement foundation, account authentication and client-encrypted vaults. Existing server-key and native AES-GCM archive protections remain unchanged; browser XChaCha20-Poly1305 keys are independent. The numbered runbook also includes future production responsibilities. See [the implemented format and limits](phase3-report.md).

Phase 4 adds managed Drive sync and startup upgrades. server/index.ts now backs up/applies pending migrations automatically using the existing key; the household user does not run commands. Migration 0004 adds OAuth/sync metadata. Developer Google registration/secret injection and exact redirect/verification requirements are in [the deployment guide](google-drive-integration.md), never in the user setup form. Maintain the database UUID/account IDs and every required protected server key version; cloud files contain no account-login database or plaintext keys.

Staged restore now also removes drive_connection, pending OAuth states, checkpoints, allocated-object mappings, caches and conflict approvals. Restored Google grants cannot silently reactivate; the administrator reconnects through Settings after account access is safely re-established. Cloud sync does not bypass reset-required flags. The older optional-backup-only section below is historical; Drive now synchronises client-encrypted vault snapshots/commits.

Before starting against an older schema, stop the backend and run `npm.cmd run db:migrate -- --maintenance`. This validates the key, creates an encrypted pre-migration backup and applies pending immutable migrations. Current migration 0003 adds encrypted profiles/snapshots/membership. Never recreate keys/accounts or edit applied migrations. Invitations use the protected-file CLI in [the backend guide](../server/README.md).

**Recovery limit:** staged restoration sets `password_reset_required`; login/session access remains blocked. No account-login recovery endpoint/reset CLI exists. Phase 3 vault recovery keys unwrap client vault keys only and do not bypass authentication. Do not manually clear this flag. A future account reset must not change vault ciphertext. Keep each user's master/recovery material available independently; the operator archive key alone cannot decrypt inner vault records.

## 1. Files and configuration

Use one persistent backend host and a dedicated operating-system service account. Keep these locations outside the repository and static web directory:

| Setting / file       | Purpose                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCKBOX_DB_PATH`    | Absolute path to the SQLite database on local persistent disk.                                                                                                                                                    |
| `LOCKBOX_KEY_FILE`   | Absolute path to the protected application-key file, introduced when encryption is implemented. Store a current key version and random 32-byte key(s), encoded only for file storage. Encoding is not encryption. |
| `LOCKBOX_APP_ORIGIN` | Fixed production HTTPS origin used for links, CSRF checks and allowed browser origin.                                                                                                                             |
| Backup directory     | Private local staging directory plus a separate destination for encrypted backups. Never publicly served.                                                                                                         |

These names are planned configuration, not newly active environment variables. The key file is not the database, a frontend environment variable, a committed `.env` value or part of a downloaded backup. Limit its access to the service account and host administrator (for example mode 0600 on Unix or equivalent Windows ACLs). Restrict database, WAL, shared-memory and staging-directory access too. A file permission is not protection against an administrator or compromised service process; that trust is already part of the architecture.

## 2. Key creation, backup and rotation

Generate the first key once using the operating system's cryptographic RNG, through an explicit future operator initialization action. Never generate/rewrite a key during normal startup, login, password reset or restore. A random key is independent of usernames and account passwords.

Before real data is stored, make a separately protected offline copy of the key file on existing encrypted removable storage or an OS-protected offline store. Keep it physically/logically separate from database backups; never place it in the same Drive folder or backup archive. Record the key version and test access to this copy. This is host administration, not a second user password or in-app recovery ceremony. No external key-management service is required.

When encrypted data exists, normal startup refuses missing/malformed keys, unavailable referenced versions or a failed authenticated key check. Add a small encrypted known-value check when the first real key is initialized so a wrong but correctly sized key is detected before serving data. An empty database in Phase 1 requires no key; credential routes remain unavailable until a later phase provides encryption. Never interpret a key failure as an empty vault.

Rotate only for compromise, algorithm/policy changes or a planned maintenance need. Under maintenance, back up the database and key file separately, add a new key version, re-encrypt records transactionally/in small restartable batches with fresh IVs, verify every record and switch the active version. Retain old versions until records and retained backup files no longer need them. A rotated wrapper/key file does not make previously copied ciphertext and keys safe; compromise may also require changing website passwords. Do not add a user-facing key rotation workflow.

AES-GCM always uses fresh random 12-byte IVs and 16-byte tags. The live-record UNIQUE IV constraint catches stored collisions, but is not a historical proof of nonce uniqueness after updates or restores. Do not implement counters that reset on restore; use the cryptographic RNG for every encryption, including backup exports, and test the selected helper's nonce/lifetime handling. Do not return plaintext from partial decryption before tag validation.

## 3. Database initialization and normal startup

Future initialization is explicit and idempotent: validate the absolute path, create a private directory only at the configured target, open/create a new empty database, apply ordered migrations, verify schema/foreign keys and report success without secrets. Re-running against an already initialized compatible database does not recreate or erase it. It does not create production accounts, default passwords, keys, Google tokens or plaintext sample credentials.

Normal production startup opens an existing database in must-exist mode. A missing/unreadable/wrong-path file is a startup failure, not permission to create a fresh empty database. A schema newer than the application understands is also a failure. Deployment explicitly runs pending migrations before serving requests; normal request handling never changes schema.

For every connection enable and verify `foreign_keys=ON`, set a 5000 ms busy timeout, use `journal_mode=WAL` and `synchronous=FULL` for this small durability-focused workload. Read settings back rather than assuming they were accepted. Only the backend accesses this local file. Keep database operations short and use parameterized SQL; never hold a transaction while hashing passwords or sending email. [SQLite PRAGMA documentation](https://sqlite.org/pragma.html).

## 4. Migrations

Use numbered immutable SQL files and `schema_migrations(version, checksum, applied_at)`. A dedicated future migration action applies missing files in order inside a transaction where SQLite permits it. Detect modified checksums, duplicate/out-of-order versions and unsupported newer schemas. Only one migration runner operates at a time; run during a short maintenance window with the app stopped. A failed migration rolls back and leaves the previous schema usable; non-transactional maintenance requires its own explicit procedure.

Back up before upgrading an existing database. Prefer forward fixes over untested automatic down-migrations. Destructive schema changes need a tested data-preserving plan and explicit implementation scope. Test clean initialization, repeated initialization, upgrade from the prior release, migration failure and restore on a disposable SQLite file. Phase 1 creates schemas/repositories only; it must not introduce a temporary plaintext credential-storage path.

## 5. Backup policy and format

Baseline: one consistent encrypted backup nightly, retained for 30 days, plus a pre-migration backup; copy completed files to storage separate from the live host. A local-only copy is not disaster recovery. Capacity/vendor selection is operational, not a new architectural service requirement. Test a full restore before real use and after meaningful storage/key-format changes.

Use the SQLite backup API/driver facility for a consistent snapshot, not a casual copy of the main file while WAL is active. The snapshot already has encrypted saved fields, but still contains sensitive account metadata/hashes; keep temporary snapshots private, encrypt the complete export promptly with the standard authenticated helper, and clean up staging files. Include format/schema/key-version identification and authenticate the complete content/metadata. Never export application keys, raw sessions/reset secrets or plaintext credential CSV as the normal backup. Avoid claiming secure physical erasure from SSDs; protected disk/staging access remains necessary. [SQLite backup documentation](https://sqlite.org/backup.html).

## 6. Restore procedure

1. Put the application into maintenance and stop the process. Preserve the current database and key configuration separately for rollback; do not overwrite the only remaining copy.
2. Obtain the encrypted backup and matching separately held key versions. Authenticate/decrypt into a private staging location; a wrong key, corrupt file or unsupported format aborts without touching the live database.
3. Check backup/schema compatibility, run SQLite integrity and foreign-key checks, and verify encrypted key checks plus representative/all saved records before activation. Apply any required forward migrations to the staged copy using the compatible release; do not let an older application open a newer schema.
4. In the staged database delete all sessions and outstanding invitation/reset/verification tokens. Since a restored backup may revive an old account hash or recovery address, require a fresh operator-assisted reset for each active account and re-verification of recovery contacts before reopening normal login. This does not change the data-encryption key or saved contents.
5. Replace the stopped database with the validated staged copy and handle WAL/shared-memory files through the documented SQLite/driver procedure, never by mixing files from different snapshots. Start with the matching key file, verify health/data access, then end maintenance. Retain the rollback copy until the restore is confirmed.

Restoration is a host-operator action, not a public file-upload endpoint. Losing every valid copy of the server key makes the saved data unrecoverable; resetting account passwords cannot repair that. A host operator who holds both data and key can decrypt it. Do not describe this as end-to-end protection.

## 7. Google Drive compatibility

The encrypted backup file is independent of its destination. A later small backup-destination adapter can upload exactly that file to Drive without changing users, credential tables, visibility rules or encryption of saved records. Initial manual upload needs no Google API. Automation, if requested, adds backend-only Google authorization/token storage and folder confinement; it does not turn Drive into the database. Keep the key backup out of the Drive backup location.

## Implemented Phase 1 scope update

The later Phase 1 implementation request explicitly includes protected key-file creation/loading and backup/restoration utilities, expanding the earlier database-only boundary. That request is the authority for these operator features; it does not enable authentication or saved-credential encryption/CRUD.

Implemented paths/actions are documented in [the backend guide](../server/README.md). Development uses private ignored `server/.data`; production validates explicit external storage paths and HTTPS origin. Database init is explicit, ordinary startup is must-exist, migrations are checksummed after BOM/line-ending canonicalization, and SQLite settings/integrity are verified.

Key initialization is explicit and separate from database initialization. The implemented sentinel is a domain-separated HMAC-SHA-256 check of the database UUID/key version under the random key, rather than the previously proposed encrypted known-value sentinel. This small change detects incorrect keys while keeping all saved-password encryption inactive. No account password participates. Protected key loading fails on missing/malformed/insecure/mismatched keys and never generates replacements during startup.

The operator backup utility creates consistent fully encrypted AES-256-GCM archives. Restoration is deliberately limited to a new empty staging directory; it never overwrites or switches the live database. It validates/authenticates first, invalidates sessions/tokens, marks account-reset-required and clears recovery-contact verification. Deployment switching, reset implementation, automatic backup schedules/retention and key rotation are not implemented. Follow the runbook above when these later features are added; the current utility covers the safe staging step only.
