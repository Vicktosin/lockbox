# Backend foundation, authentication and client vaults

Phase 7: [current release validation](../docs/phase7-release-validation.md) records actual Chrome/Edge runtime and private Caddy evidence, internal fixes and outstanding live Google/UI/physical-device/systemd/independent-review gates. Historical phase statements are not present-release certification.

Phase 6 update: [Current release assessment and recovery rehearsal](../docs/phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Current Phase 5 recovery/backup/deployment details: [guide](../docs/phase5-recovery-production.md). Google remains unconnected and live validation is pending.

Phases 1–4 implement SQLite/key/backup infrastructure, accounts, client-encrypted vaults and Google Drive v3/OAuth sync. Account-login recovery remains inactive. Drive is not connected until real developer registration and administrator consent succeed. This guide is for developers/operators; household users use Settings and do not run database or Google configuration commands.

## Phase 4 startup and deployment

Normal startup now validates the existing database/key, creates an encrypted pre-upgrade backup and applies pending migrations automatically. Migration 0004 adds six OAuth/sync tables. Do not recreate existing files or ask users to run db commands. Fresh infrastructure provisioning remains the developer's responsibility; all prior ACL/fail-closed protections remain.

The maintainer supplies LOCKBOX_GOOGLE_CLIENT_ID and LOCKBOX_GOOGLE_CLIENT_SECRET in backend-only deployment secret configuration and registers exactly LOCKBOX_APP_ORIGIN/api/drive/callback. Missing registration keeps the local app working and Drive visibly unavailable. No real client credentials are included. See [Google deployment requirements](../docs/google-drive-integration.md), including full-drive scope/verification; none of those tasks belong to household users.

Protected /api/drive routes: GET status/callback and POST connect/sync/disconnect/resolve. Mutations require existing session/CSRF/Origin checks. Only administrators connect/disconnect; each account can sync and approve its own conflict vote. Tokens never return to clients. Vault mutations schedule automatic sync; a one-minute worker polls/retries. Immutable snapshots/commits preserve history, and imports revoke sessions before re-unlocking.

Staged restore clears all OAuth/sync tables. It still marks accounts reset-required; vault recovery is not login recovery. Server identity/key backups remain necessary to authenticate/decrypt cloud metadata. No new dependency was installed. New check: npm.cmd run test:drive. [Phase 4 report](../docs/phase4-report.md) contains files/tests/limits. Older manual maintenance commands below remain developer tools, not end-user setup.

## Local setup

Use Node 24. From the project root in PowerShell:

```powershell
npm.cmd ci
```

For a new database only:

```powershell
npm.cmd run db:init
npm.cmd run key:init
```

For an existing Phase 1 database, stop the backend and upgrade without recreating it:

```powershell
npm.cmd run db:migrate -- --maintenance
```

Then:

```powershell
npm.cmd run db:check
npm.cmd run key:check
npm.cmd run dev:server
```

In another terminal run npm.cmd run dev and open http://localhost:5173. That browser origin must exactly match LOCKBOX_APP_ORIGIN (the development default). Vite proxies /api to the loopback backend on 127.0.0.1:8787. Production requires separate same-origin HTTPS/static hosting; Vite is development-only.

Initialization is explicit/idempotent, never seeds accounts/credentials and never upgrades an existing older schema silently. Key initialization creates exclusively, validates repeated runs and never replaces a lost registered key. Normal startup requires an existing database, current verified migrations and matching protected keys. It never auto-initializes.

## Account provisioning

No default password or public first-administrator claiming endpoint exists. The local host operator issues a private invitation:

```powershell
npm.cmd run auth:invite -- --role administrator --output "$PWD\server\.data\invitations\administrator.json"
```

Privately read inviteCode as the service user and paste it into Create account. After administrator registration, issue --role member using a different output file for the second user. The code is random, single-use and expires in 24 hours. Reissuing invalidates unused same-role invitations. Files are private/exclusive and never overwritten; codes never appear in command output/logs. Remove used/expired files privately. A live invitation is a bearer capability: anyone holding it can redeem it. No invite-management HTTP API is exposed.

Registration stores an Argon2id hash, not a plaintext/reversible password. Usernames are unique case-insensitively in SQLite. Master setup/unlock/recovery now run in the browser after login; no backend endpoint accepts a master password or recovery code.

## HTTP surface

| Method | Route                         | Requirement                                                          |
| ------ | ----------------------------- | -------------------------------------------------------------------- |
| GET    | /healthz                      | Infrastructure status; authentication enabled, storage disabled      |
| POST   | /api/auth/register            | Exact Origin; JSON username/password/passwordConfirmation/inviteCode |
| POST   | /api/auth/login               | Exact Origin; JSON username/password; sets HttpOnly cookie           |
| GET    | /api/auth/me                  | Valid session; public account and CSRF value                         |
| GET    | /api/auth/sessions            | Valid session; caller-owned sessions only                            |
| POST   | /api/auth/logout              | Exact Origin; CSRF if session still valid                            |
| POST   | /api/auth/logout-all          | Valid session, exact Origin, CSRF                                    |
| POST   | /api/auth/sessions/:id/revoke | Valid session, exact Origin, CSRF; own session only                  |

The real entry point enables the allowlisted /api/vault and /api/drive routes. Unimplemented paths remain 503, including login reset, legacy /api/credentials and the obsolete /api/admin/google-drive scaffold. Unknown non-API paths are 404. Cookie/session protections are unchanged: 30 minutes idle/12 hours absolute, at most ten account sessions, Secure production __Host- cookies and no browser token storage.

## Client-encrypted vault API

GET /api/vault/state returns the caller's encrypted profile/Personal snapshot and only its granted Household snapshot/check. POST routes are setup, profile, personal, move, household/create, household/grant, household/join, household/save and household/revoke under /api/vault/. Every route requires the existing authenticated session; mutations additionally require exact Origin, JSON and session-bound CSRF.

Strict wire schemas accept only versioned ciphertext/KDF metadata/IDs/revisions. No name, saved password, master password, recovery code or unwrapped key is accepted. Normal body limit remains 64 KiB; these ciphertext POST routes allow 1 MiB (2 MiB for atomic two-snapshot moves). Client plaintext documents are capped at 500,000 bytes/2,000 credentials/128 folders. Writes compare expected revisions; cross-vault moves and membership/key rotation commit atomically. Both joined users can manage all Household contents; only its owner controls membership. Private vault authorization never uses the demo profile selector.

Client XChaCha20-Poly1305 envelopes contain v=1, an algorithm identifier, a fresh base64 24-byte nonce and combined ciphertext/16-byte authentication tag. Public KDF metadata uses fixed Argon2id parameters/salt; master/recovery/keyring keys stay client-side. Phase 1 native AES-GCM archive encryption and protected application keys are unchanged. API schemas do not prove an arbitrary malicious client actually encrypted its submitted bytes; the shipped client does, with actual-crypto tests.

The factory intentionally requires explicit vaults:true to enable these routes; server/index.ts supplies it after normal schema/key verification. Legacy boundary tests omit that option to verify their original account-only/disabled fixtures; new vault integration tests exercise the enabled real configuration.

## Configuration and permissions

No .env is needed for the local application defaults. Overrides/deployment secrets belong in backend-only secret configuration. Foundation settings are unchanged; the developer additionally supplies LOCKBOX_GOOGLE_CLIENT_ID/LOCKBOX_GOOGLE_CLIENT_SECRET. The old GOOGLE_DRIVE_FOLDER_ID setting is ignored by the active provider; selected-folder links are authorised through Settings instead. Never expose these secrets through VITE_ variables.

Defaults: server/.data/db/lockbox.sqlite, server/.data/keys/application-key.json and server/.data/backups. Artifacts are ignored by Git/ESLint/Prettier/server TypeScript. Paths must be absolute and free of symlink/junction traversal; keys remain separate from databases/backups. Development project-local paths are limited to ignored server/.data. Production requires explicit paths outside the project and HTTPS origin. Listener remains loopback-only.

Private directories use owner-only Unix permissions or Windows ACLs restricted to service user, SYSTEM and local Administrators. Existing broad permissions are rejected instead of silently changed. Key/database ownership/modes or ACLs are checked. Run as the intended service user. A restricted automation token unable to inspect ancestor paths/ACLs fails closed; do not loosen protections to make tests work.

## Database and migrations

Connections verify foreign_keys=ON, WAL, synchronous FULL and a 5000 ms busy timeout. Startup checks schema history and integrity. Unchanged 0001_foundation.sql creates users, sessions, account_tokens, encrypted_payloads, folders, credentials, app_metadata and encryption_key_checks. The runner owns schema_migrations. Sharing remains owner/visibility plus credential_visibility view.

Migrations 0001–0003 remain unchanged. Migration 0004 adds the six OAuth/sync tables described above. No accounts/vaults are seeded. The current local database was automatically upgraded to version 4 with its original key and an encrypted pre-startup backup. Never edit applied migrations.

Checksums are SHA-256 of UTF-8 SQL after BOM stripping and LF normalization. Changed SQL/history, gaps and unknown newer versions fail closed. Pending SQL/history commit in one exclusive transaction or roll back. During a stopped-server maintenance upgrade, db:migrate requires the matching key and creates a consistent encrypted pre-migration archive. With no pending migration it validates without changes. No down migration exists. Failed initial creation may leave an uninitialized file; inspect and choose a fresh path rather than silently overwriting it.

## Backup and staged restore

```powershell
npm.cmd run db:backup -- --output "$PWD\server\.data\backups\manual.lbbak"
npm.cmd run db:restore -- --input "$PWD\server\.data\backups\manual.lbbak" --target "$PWD\server\.data\restore-review\lockbox.sqlite" --maintenance
```

Backup uses SQLite's snapshot facility, validates and encrypts the full archive with AES-256-GCM. It never includes the application key or exposes credential encryption APIs. Archives are private, exclusive and capped at 64 MiB; private staging is cleaned up. Separate protected offline/OS storage holds key backups, never the same Drive folder as archives.

Restore authenticates before writing, validates schema/checksums/integrity/key binding and applies supported forward migrations to a **new empty staging directory**. It clears sessions/tokens, marks accounts reset-required and clears verified recovery contacts. It never overwrites or switches the live database. Preserve a rollback copy and review before any deployment switch.

Reset-required is enforced. Account-login recovery is not implemented, so restored accounts cannot sign in yet, even if their vault recovery key is available. Never clear this protection manually. Vault recovery is a separate client feature. Old server key versions are required for their archives; missing/wrong keys and tampered files fail without replacing live data. No backup scheduling/retention or production restore switching is automated.

## Keys and logs

The protected key file contains versioned random 32-byte application secrets. A domain-separated HMAC check binds database UUID/key version; it detects missing/wrong keys without implementing saved-password encryption. Key creation/loading/ACL checks remain unchanged from Phase 1.

JSON logging allowlists timestamp/level/event/code/numeric operational fields only. No request URLs, bodies, headers, hashes, passwords, tokens, keys, raw database errors or arbitrary exceptions are logged. Generic HTTP errors omit submitted values and validation details.

## Checks and dependencies

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test:backend
npm.cmd run test:auth
npm.cmd run test:vault
npm.cmd run test:storage
npm.cmd run test:frontend
npm.cmd run build
```

Tests use disposable private directories and fictional passwords. The default backend factory without explicit authentication configuration intentionally stays disabled for legacy boundary tests; the real entry point supplies database/origin options after key verification.

Existing packages remain unchanged. Phase 3 adds only hash-wasm@4.13.0 and @noble/ciphers@2.4.0 for client key derivation/authenticated encryption. No mail, Drive SDK or service was added. Browser/crypto review and production HTTPS/CSP are still required.

[Phase 2 report](../docs/phase2-report.md) · [operations](../docs/operations.md) · [roadmap](../docs/implementation-roadmap.md)
