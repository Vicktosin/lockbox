# Phase 2 completion report

Phase 2 implements user registration, login, server-backed sessions and integration into the existing interface. No recovery, credential persistence/CRUD, master unlocking, vault encryption, Drive OAuth/uploads or Supabase is activated.

## Delivered behavior

Registration requires a private one-use household invitation, unique username, login password and confirmation. SQLite canonical CHECK/UNIQUE constraints enforce case-insensitive usernames; active-account/admin constraints remain. The host operator provisions first-administrator/member invitations using auth:invite. No default passwords, role selection, public bootstrap race or seeded accounts exist.

Argon2id uses random library salts, 64 MiB memory, time cost 3, parallelism 1 and 32-byte output. Login verifies through the library, upgrades old parameters, uses a dummy hash for unknown names and returns generic failed-authentication responses. Strict schemas, bounded IP/name limits, a two-job hash cap, parameterized queries and atomic transactions protect admission/authentication.

Sessions use fresh random 32-byte opaque tokens in HttpOnly cookies. SQLite stores purpose-separated SHA-256 digests only. Production cookies add Secure and __Host- scope; development uses a separate cookie. Validation enforces active/non-reset-required accounts, 30-minute idle and 12-hour absolute expiry. Login rotates/replaces the previous browser session; users can list approximate device labels and revoke one/all sessions. Mutations require exact Origin, and authenticated mutations require a session-bound CSRF header. No session secrets enter browser storage, JSON or logs.

The existing dashboard/layout and mock vault features are preserved behind account screens. Settings now exposes actual account/session controls alongside clearly separate demo settings. Refresh restores authentication from the server cookie; mock vault edits remain transient. Bundled fictional records are not private data.

## Requirement change and deferred recovery

The latest Phase 2 instruction restores a future independent device-local master password, overriding the earlier single-password server-decryption direction. Only the login password is implemented. No master password is accepted, transmitted, stored, derived or used for encryption. The protected Phase 1 server key and its ACL/fail-closed behavior remain unchanged for backups/key checks.

Before vault implementation, reconcile the older server AES proposal, independent local unlock, shared access and lost-master behavior. Login-password changes must not require re-encryption. Before account recovery, approve independently verifiable proof/channel for username-only accounts. No recovery endpoint, operator reset command or bypass exists now.

Staged restore intentionally marks accounts reset-required and removes sessions/tokens. Phase 2 enforces this flag. Restored accounts remain blocked until approved recovery is implemented; never clear it manually.

## Schema and local upgrade

Migration 0001 is unchanged. Additive 0002_authentication.sql adds sessions.device_label and sessions.user_agent with length constraints, plus account_tokens.invite_role and insert/update purpose-role validation triggers. All prior tables/views/ownership rules remain. No separate permission service or device registry is added.

The existing local Phase 1 database was upgraded through db:migrate -- --maintenance, including an encrypted pre-migration backup. Verification reported migration versions [1,2], matching existing key binding, zero accounts, zero sessions and zero credentials. No operator invitation or account was created in the real local database.

## Exact installed dependencies

| Package         | Version | Scope                                        |
| --------------- | ------- | -------------------------------------------- |
| argon2          | 0.45.2  | Runtime password hashing/verification/rehash |
| @fastify/cookie | 11.1.5  | Runtime cookie support                       |

Existing Fastify 5.12.8, better-sqlite3 13.0.3 and @types/better-sqlite3 9.6.0 remain. No frontend dependency, mail package, Google SDK or new service was added. package-lock.json records exact transitive resolution.

## Files created

- server/auth/errors.ts
- server/auth/invitations.ts
- server/auth/rate-limit.ts
- server/auth/routes.ts
- server/auth/service.ts
- server/database/migrations/0002_authentication.sql
- src/features/auth/api.ts
- src/features/auth/auth-gate.tsx
- src/features/auth/auth-screen.tsx
- src/features/auth/account-panel.tsx
- scripts/check-auth.mjs
- docs/phase2-report.md

## Files modified

- package.json and package-lock.json — dependencies and authentication/invitation scripts.
- server/.env.example and server/config/foundation.ts — exact development browser origin defaults.
- server/cli.ts — protected-file invitation provisioning, safe errors.
- server/http/app.ts and server/index.ts — allowlisted account routes, explicit auth configuration, strict validation/error handling after existing key checks.
- vite.config.ts — development same-origin API proxy; existing PWA/build configuration retained.
- src/app/App.tsx — account gate and account-aware composition; preserved demo workspace.
- src/components/layout/app-shell.tsx — account name and logout.
- src/features/dashboard/dashboard.tsx — actual account welcome name.
- src/features/settings/settings.tsx — distinguish demo profile switching.
- src/index.css — responsive authentication/account styles.
- src/features/README.md — updated module boundaries.
- scripts/check-backend.mjs — migration-aware expectations, explicit legacy session columns, private invitation CLI regression test.
- scripts/check-frontend.mjs — preserved workspace tests plus actual application account-gate tests.
- README.md and server/README.md — current setup, account provisioning, routes, commands and limits.
- docs/architecture.md, docs/authentication-security.md, docs/authentication-data-model.md, docs/security-decisions.md, docs/implementation-roadmap.md, docs/operations.md and docs/google-drive-integration.md — current implementation, requirement change, recovery boundary and future gates.

No Phase 1 key-file, private-permissions, archive, backup/restore or database-runner implementation was weakened or replaced. No existing migration or mock credential fixture was edited. The workspace is not a Git repository, so this is an explicit implementation inventory rather than a Git diff.

## Verification

All required checks passed on Node 24/Windows:

| Check                 | Result                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------- |
| npm run typecheck     | Frontend/build-config and backend TypeScript pass                                      |
| npm run lint          | ESLint, zero warnings                                                                  |
| npm run format:check  | Prettier pass                                                                          |
| npm run build         | Production Vite/PWA build pass; automatic service-worker registration remains disabled |
| npm run test:auth     | 13/13 pass                                                                             |
| npm run test:backend  | 12/12 pass                                                                             |
| npm run test:frontend | 13/13 pass                                                                             |
| npm run test:storage  | 4/4 pass                                                                               |

Total: **42 passing automated tests**.

Authentication tests cover successful registration, password confirmation, case-variant duplicate rollback, invalid/extra fields, origins, expired/replaced/replayed invitations, concurrent redemption, Argon2 verification/rehash, generic unknown/wrong login, IP/name limits/forwarded-header spoofing, cookie flags/digest storage, restart persistence, scoped sessions, CSRF, logout/revocation/all-session logout, rotation, idle/absolute expiry, inactive/reset-required accounts, integrity and inactive vault/Drive/recovery boundaries.

Foundation regression tests cover migration creation/repetition/checksums/gaps/newer schema/rollback, constraints, key creation/loading/missing/malformed/wrong/insecure ACL failure, encrypted backup and isolated restore, configuration, safe logs, CLI behavior and private invitation files with overwrite refusal/no secret output.

Frontend tests preserve all eight previous workspace scenarios and add five account-gate/form/login/reload/device/logout scenarios with mocked HTTP responses. They assert no account-token browser storage. These are simulated DOM tests, not a visual/accessibility/TLS-cookie browser audit.

The real backend entry point was started with the migrated local database. GET /healthz reported authentication enabled/storage disabled; /api/auth/me returned 401 without a cookie, and credential/recovery/Drive paths returned 503. No real accounts or vault data were created. Temporary task-created listeners were stopped; existing development listeners were preserved.

## Issues and remaining risks

ESLint initially found a control-character regex and embedded BOM whitespace; both were corrected. Protected Windows paths require running tests/maintenance as the service user with ACL-inspection access. The restricted automation token failed closed; checks were rerun with the host token, without relaxing ACLs.

npm audit --omit=dev reported zero runtime vulnerabilities at verification time. Full npm audit reports **15 development-tooling findings: 2 low and 13 moderate**, involving inherited ESLint/typescript-eslint/PWA/Workbox dependency chains. Forced fixes propose breaking tool changes; none were applied outside this phase. Review them separately before release.

Process-local limits reset on restart and can be exhausted; behind the current proxy users share its IP bucket. Device descriptions are spoofable labels, not attestation. No mandatory MFA, breached-password screening or penetration test is included. XSS/host compromise remain risks despite cookie/CSRF protections. Production same-origin HTTPS/static CSP/proxy behavior and deployment Argon2 memory/latency must be tested. No real saved credentials should be entered.

## Run and next phase

Start npm.cmd run dev:server and npm.cmd run dev in separate terminals, then open http://localhost:5173. Provision the private administrator invitation with the command in [the backend guide](../server/README.md); issue the member invitation after the first registration. Recovery is unavailable, so retain the account login password.

Next: approve username-only recovery proof and reconcile independent master unlocking/shared vaults before implementing recovery or credential encryption. No further decision blocks this completed account-only phase.
