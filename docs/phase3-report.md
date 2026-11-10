# Phase 3 implementation report

Implemented the complete local client-encrypted vault engine and connected it to the existing interface. This is working code, not an architecture-only phase. It is not production-security certification.

## Delivered

- Separate master-password creation/confirmation and unlocking after account login.
- Browser Argon2id with a dedicated disposable worker, fixed 64 MiB/time-3/parallelism-1 parameters and random 16-byte salts.
- Independent random 256-bit account-root, Personal and Household keys.
- Versioned authenticated key wrapping and credential/folder encryption.
- Persisted credential create/read/edit/delete, Personal/Household moves, categories and folder create/rename/remove/assignment.
- Existing search, filters, list/grid, details, reveal/copy, password generation, dashboard and appearance controls.
- Manual lock, logout/page-exit lock and five-minute inactivity locking, with background-return deadline checks.
- Clipboard clearing attempts after 30 seconds/on lock, preserving unrelated clipboard contents when readable and reporting permission failures.
- Complete recovery-key generation/verification, local master recovery, recovery-key rotation and current-master-verified master changes.
- Household creation, explicit per-account grant/join, private key transfer and owner-controlled removal with shared-key rotation.
- Existing account hashes, sessions, CSRF/origin controls, rate limits, safe logs, database checksums/key-file protections and encrypted backups preserved.

No Google Drive connection, Supabase, Google Sign-In, account-login recovery, browser offline persistence or production deployment is activated.

## Dependencies and cipher decision

Added exact runtime dependencies **hash-wasm@4.13.0** and **@noble/ciphers@2.4.0**. Existing server argon2@0.45.2, cookie/Fastify/SQLite packages remain unchanged.

The shipped client uses **XChaCha20-Poly1305**, with random 24-byte nonces and 16-byte combined authentication tags. This established construction avoids the pure-JavaScript AES T-table timing caveat documented by the selected library. The earlier native/server AES proposal is superseded for new client vault records only; Phase 1 native AES-GCM archives and protected application keys are unchanged. No client AES profile was stored in the real local database or released during development.

References: [noble security notes](https://github.com/paulmillr/noble-ciphers#constant-timeness), [libsodium construction guidance](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction), [hash-wasm implementation](https://github.com/Daninet/hash-wasm). Library audit history does not certify this exact application or eliminate JS/WASM risks.

## Encryption format v1

An envelope has v=1, alg=XChaCha20-Poly1305, a base64 24-byte nonce and base64 ciphertext with a combined 16-byte tag. Unsupported versions/algorithms, malformed encoding, wrong keys/context or altered ciphertext fail closed. Nonces come from crypto.getRandomValues for every encryption.

The authenticated additional-data prefix is LOCKBOX|1| followed by an explicit context:

- master:accountId:salt binds the master-derived wrapper to its account and random salt; KDF name/cost profile is fixed/validated.
- recovery:accountId independently wraps the same root with a random 256-bit recovery key.
- keyring:accountId encrypts the Personal key and optional Household ID/key under the random root.
- vault:vaultId:revision binds encrypted credential/folder documents to their vault/revision.
- household-check:householdId verifies possession of a transferred shared key.

A profile stores only public version/KDF/salt metadata and master/recovery/keyring envelopes. No separate master hash, plaintext master/recovery code or unwrapped key goes to the backend. The root, Personal key and shared key are random and independent. The Personal and shared keys encrypt different documents.

Setup verifies the whole recovery code by unwrapping/authenticating the root/keyring before saving. Master changes verify the current master and derive a fresh wrapper/salt around the same root; credential ciphertext is unchanged. Recovery unwraps the same root, prepares a new master wrapper and fresh recovery wrapper, verifies the replacement code, then commits against the profile revision. The old recovery code stops opening the current profile. Older archives may retain older wrappers; neither password changes nor revocation erase history.

In browsers, derivation runs in a separate worker with a 60-second timeout and worker termination afterward. Node/component tests use the identical fixed-cost hash-wasm algorithm directly; no weaker test KDF or mock cipher is used. Native Argon2id comparison and a published XChaCha construction vector validate primitive compatibility. The browser worker bundle builds successfully, but actual browser execution remains a manual verification gap.

## SQLite and authorization

Additive migration **0003_client_vault.sql** creates:

| Table                 | Purpose                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| client_vault_profiles | One account FK/PK, positive revision and encrypted profile JSON                |
| client_vaults         | Personal/Household ID/scope/owner/revision and opaque encrypted snapshot/check |
| client_vault_members  | Vault/account FKs, composite PK and pending/joined status                      |

Partial UNIQUE indexes enforce one Personal vault per owner and one Household vault. Existing migrations 0001/0002, account/session records, protected key sentinels and reserved credential tables are unchanged. No accounts/vaults are seeded.

Every vault route validates the existing cookie session. Mutations require exact Origin, JSON, strict allowlisted fields and the session CSRF value. There is no caller-supplied owner override. Personal state/writes derive ownership from the session. Household data is exposed only to granted accounts; pending members can verify encrypted contents, but only joined members can save. The administrator has no other-user Personal read override.

The current snapshot model intentionally makes all Household content collaborative: joined accounts can edit/delete/move shared credentials/folders, while only its owner manages membership. This replaces the previously reserved per-item owner-only mutation proposal, not a previously working credential API.

Expected revisions reject stale writes. Profile setup, Household creation/join, cross-vault moves and member removal/key rotation use immediate transactions. A stale second snapshot rolls back the first update. Cryptography runs outside SQLite transactions. Errors/logs never serialize inputs or raw exceptions.

Household key transfer is deliberately explicit: the owner grants the account and sends the high-entropy transfer code privately; the recipient checks it locally and wraps it in their own keyring. Removal generates a new shared key and atomically re-encrypts the snapshot/check, updates the owner's keyring and removes membership. Re-granting needs the new code. Former members keep any old copied secrets/snapshots; future access is protected.

## Frontend and lifecycle

The actual authenticated entry point now gates the original workspace through vault setup/unlock. It starts empty; mock records are not imported into live vaults. The original eight demo scenarios remain as regression tests of the preserved workspace. Demo profile/reset controls are absent from the live settings.

All credential/folder fields, including titles, URLs, usernames, passwords, notes and categories, are encrypted before persistence. Server/account IDs, scope, revision, salts/KDF parameters and ciphertext lengths remain visible. Client-side validation checks decrypted field limits, categories, IDs, HTTP(S) URLs and folder references.

Unlocked keys/documents live only in process/React memory. Lock zeroes owned key buffers, drops document references and unmounts decrypted screens. Session rejection on a vault operation locks keys; authentication handling returns to sign-in. Late save responses cannot reopen a locked engine. Refresh/tampering failures lock rather than substitute an empty vault.

Inactivity uses elapsed time and checks before accepting activity after expiry; timers are checked again on focus/visibility return. Pending recovery/setup codes also clear when the tab is hidden. A background tab may have browser-suspended timers until return. Page exit locks. Clipboard operations are best effort; permission denials are surfaced, OS clipboard history cannot be purged and JavaScript strings/GC/OS paging cannot promise secure physical erasure.

## Tests and checks

| Check         | Result                                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| test:vault    | 14 passing tests                                                                        |
| test:frontend | 20 passing tests                                                                        |
| test:auth     | 13 passing tests                                                                        |
| test:backend  | 12 passing tests                                                                        |
| test:storage  | 4 passing tests                                                                         |
| typecheck     | Frontend/build-config and backend pass                                                  |
| lint          | ESLint, zero warnings                                                                   |
| format:check  | Prettier pass                                                                           |
| build         | Production Vite build, worker bundle and existing inactive-registration PWA output pass |

Total: **63 automated tests**. Full existing suites were run; entry-point expectations were updated to require master unlock rather than silently bypass it. Foundation migration tests now choose their synthetic future version dynamically.

Coverage includes correct/wrong/confirmation master input, actual key derivation/encryption/decryption, published cipher vectors, native KDF compatibility, tampering/context/key/version rejection, encrypted credential/folder/category CRUD and scope moves, user isolation, separate shared keys, grant/join/revocation/rotation, stale-write/atomic rollback, locking/zeroed owned buffers/idle deadlines, master changes, recovery replacement/verification and existing authentication/backup protections.

Leak tests inspect real SQLite/WAL artifacts, safe logs and vault-client generated requests for fictional credential names/URLs/usernames/passwords/notes/folders/master/recovery material. Frontend tests assert no plaintext in saved ciphertext or generated vault requests and empty persistent browser storage; they exercise the actual master/recovery UI with real crypto. Clipboard tests advance the real 30-second deadline with fake timers, check unrelated content preservation and permission failures.

The existing local database was upgraded with the backend stopped through db:migrate -- --maintenance. An encrypted pre-upgrade backup was created; key binding verified. It has migration versions [1,2,3] and **zero accounts/vault profiles**, so tests did not seed the working database. The real server entry point reported client-encrypted storage and returned 401 for unauthenticated /api/vault/state and /api/auth/me; Google and account-recovery routes remained 503. The smoke-test process was stopped.

Runtime audit: npm audit --omit=dev reports zero vulnerabilities at verification time. Installation still reports the inherited 15 development-tooling advisories (2 low/13 moderate); no forced breaking ESLint/PWA update was applied.

Real-browser access was unavailable. The Windows computer-use skill also forbids password-manager website automation, so real-browser worker/clipboard/layout/mobile checks were not performed. [Exact skill](<C:/Users/Emmanuel Thomas/.codex/plugins/cache/openai-bundled/computer-use/26.1027.30824/skills/computer-use/SKILL.md>) instruction: “Do not automate password manager apps or password manager websites.” This does not block the implemented feature or automated component/backend tests.

## File inventory

Created:

- shared/client-vault.ts
- server/database/migrations/0003_client_vault.sql
- server/vault/routes.ts
- src/features/vault/api.ts, crypto.ts, engine.ts, kdf.ts and kdf.worker.ts
- src/features/vault/idle-lock.ts, vault-gate.tsx, vault-settings.tsx and folders.tsx
- src/lib/secure-clipboard.ts
- scripts/check-vault.mjs
- docs/phase3-report.md

Modified:

- package.json/package-lock.json — exact client crypto dependencies and test:vault script.
- server/index.ts, server/http/app.ts and server/auth/routes.ts — explicitly enable authenticated ciphertext routes while preserving existing controls.
- src/app/App.tsx and src/components/layout/app-shell.tsx — existing workspace integration, lock/status controls and live/demo separation.
- src/components/ui/copy-button.tsx — timed/lock clipboard clearing.
- src/features/auth/auth-gate.tsx, auth-screen.tsx and account-panel.tsx — master gate and current feature descriptions.
- src/features/credentials/types.ts, credential-dialogs.tsx and credential-library.tsx — folder assignment, encrypted saves and accurate live behavior.
- src/features/dashboard/dashboard.tsx, src/features/settings/settings.tsx and src/index.css — preserve layout while adding real vault controls/appearance and removing live demo controls.
- scripts/check-backend.mjs and scripts/check-frontend.mjs — migration-aware regression and real-crypto UI/clipboard tests.
- README.md, server/README.md and src/features/README.md — running/usage/feature instructions.
- docs/architecture.md, authentication-security.md, authentication-data-model.md, security-decisions.md, implementation-roadmap.md and operations.md — implemented boundaries, schema and operational limits.

No changes to existing key-file/ACL, migration-runner, native backup/archive or Google implementation were needed. Existing migrations remain immutable. The workspace is not a Git repository, so this is an explicit file inventory rather than a Git diff.

## Limitations and independent review

1. Independent cryptographic/application review is required for the entire key hierarchy, envelope/AAD composition, recovery, Household transfer/rotation, permissions and races; dependency audits/vector tests are not application certification.
2. Browser-delivered code remains trusted. A compromised host/XSS/extension can steal keys/passwords while entered/unlocked. Review CSP, TLS, WASM/dependency provenance and JS memory/timing behavior.
3. Snapshot limits are 500,000 plaintext bytes, 2,000 credentials and 128 folders per vault; writes need the backend and conflicts require reload. There is no offline browser persistence or live multi-device push sync.
4. Recovery is vault-only and requires account access. Username-only login recovery is still unimplemented. Staged restored accounts stay reset-required; do not bypass the flag. A complete production account-plus-vault restore drill remains blocked on proper account recovery.
5. Master changes/recovery cannot erase old wrappers from backups, revoke previously exfiltrated data keys or remotely lock another already unlocked tab. A compromise of actual data keys requires a separate data-key rotation/re-encryption procedure. Server/client authorization and AEAD do not establish an external freshness anchor against full valid-database rollback. Authorized malicious accounts/server operators can destroy opaque data. Corrupt shared ciphertext fails the combined unlock rather than silently showing an empty shared vault; this can block the combined workspace until valid data is restored, although private ciphertext is unchanged.
6. Shared-key transfer needs a private independently verified channel. Removal protects future current snapshots; it cannot recall retained history or copied plaintext.
7. Clipboard clearing, physical memory erasure and exact background-timer timing are platform-limited. Actual browser/mobile/worker behavior and resource benchmarks remain manual review tasks.
8. No production hosting/HTTPS/CSP, mandatory MFA, breached-password screening, Google integration, account deletion/ownership transfer or public deployment is added. Existing development advisories need separate review.

## Run

Start npm.cmd run dev:server and npm.cmd run dev in separate terminals; open http://localhost:5173. Existing users sign in and create/unlock their own vault. A new installation needs the protected administrator invitation flow in [the README](../README.md). No further architecture approval is required for these implemented local features.
