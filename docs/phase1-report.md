# Phase 1 completion report

Phase 1 is implemented. Authentication, registration/login/reset endpoints, password-hashing/storage services, saved-credential encryption/CRUD, sessions as a product feature, Google OAuth/uploads and frontend integration remain inactive. The schema and operator utilities are infrastructure, not an account/vault implementation.

## Files

Created:

- `server/cli.ts`, `server/errors.ts`, `server/logging.ts`.
- `server/config/foundation.ts`.
- `server/database/connection.ts`, `server/database/migrations.ts`, `server/database/migrations/0001_foundation.sql`.
- `server/http/app.ts`.
- `server/security/private-files.ts`, `server/security/key-file.ts`.
- `server/maintenance/archive.ts`, `server/maintenance/backups.ts`.
- `scripts/check-backend.mjs`, this `docs/phase1-report.md`.

Modified:

- `server/index.ts`, `server/.env.example`.
- `package.json`, `package-lock.json`, `tsconfig.server.json`, `eslint.config.js`, `.gitignore`, `.prettierignore`.
- `README.md`, `server/README.md`.
- `docs/architecture.md`, `docs/authentication-data-model.md`, `docs/google-drive-integration.md`, `docs/implementation-roadmap.md`, `docs/operations.md`, `docs/security-decisions.md`.

No files in `src/`, Vite/frontend TypeScript configuration, `index.html` or `components.json` changed; their aggregate SHA-256 matched before/after. Local empty database/key files were created under ignored `server/.data`; disposable test directories were removed. No actual key material appears in this report, source or frontend build.

## Exact dependencies

| Package                 | Version | Scope       |
| ----------------------- | ------- | ----------- |
| `better-sqlite3`        | 13.0.3  | Runtime     |
| `fastify`               | 5.12.8  | Runtime     |
| `@types/better-sqlite3` | 9.6.0   | Development |

Native SQLite smoke test succeeded on Node 24.21.0/Windows and reported SQLite 3.53.4. No Argon2, cookie/auth, SMTP, Google or additional infrastructure package was installed. The production dependency audit reported zero vulnerabilities. npm installation still reported the existing 15 development-tool findings (2 low, 13 moderate); no forced dependency upgrades were applied.

## Schema and operational behavior

Tables: `schema_migrations`, `app_metadata`, `encryption_key_checks`, `users`, `sessions`, `account_tokens`, `encrypted_payloads`, `folders`, `credentials`. Sharing uses owner/visibility fields plus the `credential_visibility` view. Constraints cover canonical usernames, two active users/one active administrator, digest lengths/purposes, folder ownership/visibility inheritance, restricted deletes and payload IV/tag/version structure. Tables contain no production users, password hashes or saved credentials.

Normal startup requires an initialized existing database and protected matching key file. Initialization, migrations and key creation are explicit CLI actions. SQL SHA-256 checksums normalize one BOM and CRLF/CR to LF for portability; edits/gaps/newer history are rejected and failed migrations roll back. Configuration enforces absolute separated paths and production HTTPS/external storage. Logs serialize only allowlisted metadata, not URLs/bodies/headers/config/secrets/raw errors.

Windows ACLs or Unix owner-only permissions protect runtime storage; symbolic links/junctions and unsafe permissions are rejected. Database UUID-bound HMAC key checks detect wrong valid-length keys without implementing credential encryption. Key creation is exclusive/idempotent and refuses to replace a lost registered key.

Backup uses a consistent SQLite snapshot and AES-256-GCM to encrypt the entire operator archive, excluding the key. Restore is authenticated/validated into a new empty directory only, never overwrites live data, clears sessions/account tokens, marks user password resets required and clears recovery-contact verification. Snapshot limit is 64 MiB. Scheduling/retention cleanup, live switch, key rotation and actual password reset are not implemented; the operator guide describes the boundary.

## Validation

- 11 backend tests passed: creation/settings/repeated init; checksum/order/newer-version detection and rollback; account/FK constraints; key create/load/idempotency/missing/wrong/malformed cases; unsafe Windows ACL denial; folder inheritance/version constraints; encrypted backup/corrupt/wrong-key/no-live-overwrite restoration; config; structured log filtering and Fastify API rejection; CLI verification and missing-key startup.
- All 4 existing storage-boundary tests and 8 frontend tests passed (23 total).
- Frontend/backend TypeScript, ESLint, Prettier and production build passed.
- Live Fastify startup/health passed. Registration, login, credential and Drive requests returned 503. The server was then stopped after verification.
- Local development initialization/key checks passed; direct counts confirmed no users, credentials, folders, sessions or account tokens. Built frontend assets contained none of the checked backend/key markers or local key material.

Windows path/ACL checks cannot run inside the restricted automation token because it cannot inspect ancestor/private metadata; they passed in the normal host process without loosening permissions. The formatter similarly needed normal host directory traversal to honor the ignored private directory. A deprecated Fastify logging option found during testing was removed. No outstanding build/type/lint/test failures remain.

## Run and next boundary

The local development foundation has been initialized. Start it with `npm.cmd run dev:server`; use `npm.cmd run dev` separately for the unchanged frontend demo. Full setup/backup/restore commands are in [the backend guide](../server/README.md).

No further feature was activated. Phase 2 account authentication requires a separate instruction. Keep fictional data in the frontend until later authenticated encrypted-persistence work is complete. Before any real use, separately back up the protected server key and validate the chosen production host; the repository's local default directories alone are not disaster recovery.
