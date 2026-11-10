# Security technology decisions

Phase 7: [current release validation](phase7-release-validation.md) records actual Chrome/Edge runtime and private Caddy evidence, internal fixes and outstanding live Google/UI/physical-device/systemd/independent-review gates. Historical phase statements are not present-release certification.

Phase 6 update: [Current release assessment and recovery rehearsal](phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Phase 5 update: [Recovery and production preparation](phase5-recovery-production.md) is the current authority for login recovery codes, complete encrypted backups, safe restoration, retained history and deployment templates. Older deferred-recovery/database-only descriptions below are historical where superseded. Live Google validation and independent review remain outstanding.

Phases 1–3 are implemented. The latest authorised implementation supersedes the old server-decryption/architecture-only plan. [Phase 3 report](phase3-report.md) documents the actual format, tests and remaining review requirements.

Phase 4 now implements Google OAuth/Drive v3 and immutable encrypted synchronisation; the old optional-backup-only/inactive-Drive entries below are superseded by [the current integration decisions](google-drive-integration.md). No new dependency, identity provider or client-key scheme was added. Full Drive scope is a documented developer-verification/security-review tradeoff required by paste-existing-folder access without Picker. Server HKDF/native AES-GCM protects tokens/cloud metadata; client master/Personal/Household encryption remains unchanged. Google registration belongs to the developer, not household users.

| Concern                         | Implemented choice                                                                        | Reason                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Backend                         | Node 24, TypeScript, Fastify 5.12.8                                                       | Existing single backend, strict validation and no new service                                           |
| Database                        | SQLite / better-sqlite3 13.0.3                                                            | Existing lifecycle, constraints, immutable migrations, local durability and backups                     |
| Account passwords               | argon2 0.45.2, Argon2id, 64 MiB/time-3/parallelism-1                                      | Existing vetted salted PHC hashing/verification/upgrades; no reversible storage                         |
| Browser master KDF              | hash-wasm 4.13.0, Argon2id with same cost profile and random 16-byte salt                 | Browser WASM implementation cross-checked against native Argon2id; worker isolates expensive derivation |
| Client authenticated encryption | @noble/ciphers 2.4.0, XChaCha20-Poly1305                                                  | Established authenticated cipher with 192-bit random nonces; no custom cryptographic algorithm          |
| Key hierarchy                   | Independent random 32-byte root, Personal and Household keys                              | Sharing does not reveal Personal keys; master changes only rewrap the root                              |
| Vault recovery                  | Independent random 256-bit recovery wrapper, complete-key verification and rotation       | Local possession-based vault recovery without server escrow or plaintext keys                           |
| Sessions                        | Existing cookie plugin/digest-backed SQLite sessions                                      | Preserve Phase 2 expiry, CSRF, origin checks, rate limits and revocation                                |
| Persistence                     | Versioned encrypted snapshots with expected revisions                                     | All credential/folder fields stay encrypted; small two-user model and atomic cross-scope moves          |
| Sharing                         | Explicit account grant plus private Household-key transfer; owner removal rotates the key | Independent access without Google accounts or another sharing service                                   |
| Operator backups                | Existing native Node AES-256-GCM, protected separate server key                           | Preserve Phase 1 archive format, ACL checks and fail-closed startup                                     |
| Account-login recovery          | Deferred                                                                                  | Username-only accounts lack independently verified requester proof/channel                              |
| Drive/infrastructure            | Inactive/unchanged                                                                        | No OAuth, uploads, Supabase, Google Sign-In, Redis or mandatory MFA                                     |

## Cipher and persistence decisions

The previous AES proposal referred to server/native storage encryption. Phase 3 requires client encryption. The pure JavaScript AES implementation exposes a documented T-table timing caveat, so the shipped client uses noble's established XChaCha20-Poly1305 implementation instead. No client AES format was released or stored in the real local database during development. Existing native AES-GCM backups are unchanged.

This choice follows [library security notes](https://github.com/paulmillr/noble-ciphers#constant-timeness) and [libsodium's extended-nonce AEAD guidance](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction). It does not claim that all JavaScript/WASM timing or memory risks are solved, nor that an older library audit certifies this version/application.

The old reserved per-item ownership/delete proposal is replaced by collaborative Household snapshots: both joined members manage shared contents; only its owner manages membership. The old credential tables remain immutable/reserved, not an alternate plaintext API. This avoids an unnecessary permissions/key-envelope system for two users while preserving strict Personal isolation.

## Key and recovery boundaries

Login passwords authenticate accounts and never derive vault keys. Master passwords stay local and wrap an independently random root. That root encrypts a keyring; independent Personal/Household keys encrypt data. The recovery key independently unwraps the root; it never resets login. Server protected keys support archives/key checks, not vault unlocking.

Master changes require current-master verification and preserve credential ciphertext. Recovery verifies the complete replacement recovery code before committing a new master/recovery wrapper. Lost master plus lost recovery key means lost vault decryption. Existing unlocked tabs and old backups can retain prior access material; wrapping changes do not remotely erase memory/history.

Household revocation re-encrypts the current shared document under a fresh key atomically with membership removal and owner-keyring replacement. Re-granting requires the new transfer key. Previously copied secrets/old snapshots are not revoked.

## Controls and review gates

Existing strict schemas, parameterized SQL, session validation, CSRF, exact Origin, no-store responses, safe logs, account limits and protected key files remain. No actual credential plaintext is staged in SQLite/WAL or persistent browser storage. The client validates decrypted document shape/URLs/folder links and fails closed on unsupported formats/tampering.

Independent review must assess the complete composition: key wrapping/AAD/nonce use, KDF/WASM provenance and resource cost, recovery possession/rotation, Household transfer/rotation/concurrency, XSS and trusted JavaScript delivery, browser memory/clipboard/background behavior, authorization and malicious-server rollback. The client cannot prove server freshness after a complete database rollback, and the server cannot verify opaque clients submitted encrypted bytes.

Real-browser verification remains manual because the browser host was unavailable. Production requires reviewed HTTPS/static CSP, deployment performance, dependency findings and a complete account-plus-vault restore drill. Account reset remains deferred and staged restored accounts stay blocked. No architecture approval is needed to use the completed local engine; production deployment is separate.
