# Account and vault security

Phase 7: [current release validation](phase7-release-validation.md) records actual Chrome/Edge runtime and private Caddy evidence, internal fixes and outstanding live Google/UI/physical-device/systemd/independent-review gates. Historical phase statements are not present-release certification.

Phase 6 update: [Current release assessment and recovery rehearsal](phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Phase 5 update: [Recovery and production preparation](phase5-recovery-production.md) is the current authority for login recovery codes, complete encrypted backups, safe restoration, retained history and deployment templates. Older deferred-recovery/database-only descriptions below are historical where superseded. Live Google validation and independent review remain outstanding.

Account authentication from Phase 2 and client vault unlocking from Phase 3 are active. **Account-login recovery/password changes remain inactive.** See [Phase 3 implementation/crypto details](phase3-report.md) and [historical Phase 2 evidence](phase2-report.md).

Phase 4 adds a separate administrator-only Google storage OAuth connection, not Google Sign-In. State/PKCE are one-use/session-bound, tokens stay encrypted on the backend, and existing cookie/Origin/CSRF controls protect Drive actions. Wife-side sync never returns Google credentials or administrator private ciphertext. Cloud replacement requires all accounts' independent approval on conflicts; imports revoke sessions before re-unlocking. See [Drive security and deployment scope](google-drive-integration.md).

## Account authentication

Two independent accounts register with private single-use invitations. The host operator issues the first administrator invitation only before any accounts exist, then the member invitation. Codes contain 32 random bytes, expire after 24 hours and are written to protected exclusive files, never logs/output. Roles are server-controlled. SQLite enforces two active users, one active administrator and canonical username uniqueness.

Usernames are 3–32 ASCII letters/digits/underscores with surrounding ASCII whitespace trimmed; display case is preserved and lookup is lowercase. Database CHECK/UNIQUE constraints enforce this under races. Login uses usernames, never email or Google Sign-In.

Login passwords require 15–128 Unicode scalar values, at most 512 UTF-8 bytes, no lone surrogates, silent normalization/truncation or composition rules. Argon2id uses argon2@0.45.2, random library salts, PHC storage, 64 MiB/time-3/parallelism-1 and parameter upgrades. Unknown users perform dummy verification; failed logins are generic. No plaintext/reversible account passwords are stored.

Limits: five canonical-name attempts/15 minutes, thirty IP attempts/15 minutes and five registration attempts/IP/hour. Success resets the name counter. At most two hash jobs execute; overload returns 429. Fixed-window counters are bounded to 10,000 entries, process-local and reset on restart. Forwarded IP headers are not trusted; current proxy users share its IP bucket. No Redis/permanent lockout/mandatory MFA is introduced.

## Sessions and API access

Fresh random 32-byte session secrets live only in HttpOnly cookies; SQLite stores purpose-separated SHA-256 digests. Production uses __Host-lockbox_session with Secure/SameSite=Lax/Path=/ and no Domain; development HTTP uses a distinct cookie. No tokens enter localStorage/IndexedDB/sessionStorage. React holds public account data and a session-bound CSRF value in memory.

Server validation checks active/non-reset-required accounts and 30-minute idle/12-hour absolute expiry. Login rotates/replaces the browser session; logout and per-account individual/all-session revocation remain. At most ten sessions are retained. Browser labels are approximate, not device attestation.

Mutations require exact configured Origin, reject cross-site Fetch Metadata and validate strict JSON fields. Authenticated mutations require the session's CSRF header. Parameterized SQL and transactions enforce account/vault scope and revision checks. API responses are no-store/no-referrer/nosniff with restrictive JSON CSP. Logs omit passwords, tokens, keys, bodies, headers, URLs and arbitrary errors. Production needs same-origin HTTPS/static CSP; no CORS grant exists.

Every vault route uses these existing session/CSRF protections. Private data is not returned by guessed user/vault IDs. Membership and client keys are both required for Household access. Login expiry clears the active client engine when a vault request is rejected; focus revalidation and vault idle locking also remain.

## Independent vault unlocking

The master password is separate from login and never transmitted. Browser Argon2id derives a wrapping key; random root/Personal/Household keys and versioned XChaCha20-Poly1305 envelopes encrypt all credential/folder fields before persistence. Decryption is local, with authenticated contexts and tamper rejection. No decrypted key or credential is persisted in browser storage. On lock, byte buffers are zeroed and decrypted views discarded; JS strings, GC, OS paging and browser extensions prevent a guarantee of physical memory erasure.

Master changes verify the old master and rewrap the existing root under a fresh salt/derived key. They do not rewrite credentials or change the login hash. Existing unlocked tabs keep their keys until lock; old backups may retain old password wrappers.

The random 256-bit recovery key independently wraps the same root. Setup verifies the complete code before saving; recovery requires logged-in account access, decrypts locally, replaces the master wrapper and rotates/re-verifies the recovery code before committing. Neither the code nor master password is sent to the server. Loss of both means losing vault decryption; no administrator escrow/backdoor exists. A stolen recovery key plus account/ciphertext access compromises that account's vault keys.

Household owner grants access and transfers its key over a private, independently verified channel. The recipient verifies an authenticated key check before joining. Removal rotates shared keys/ciphertext; former members retain any old keys, snapshots or copied secrets. Joined users collaborate on all shared contents. The backend cannot inspect the encrypted item ownership/content.

## Account-login recovery stays deferred

Username-only accounts have no verified recovery channel today. No forgot-password/reset/change endpoint, operator reset command or public bypass exists. Reserved schema purposes are not features.

Before implementation, approve independently verifiable proof/channel, such as an optional verified contact using existing SMTP or a documented operator verification process. A username, unverified address or the other household login is insufficient. Future one-use digest-only expiring tokens need generic responses, throttling and atomic redemption/session revocation. Reset must change login authentication only, never vault ciphertext or master-derived access.

Staged restoration clears sessions/tokens and marks accounts reset-required. Login remains blocked until an approved account recovery mechanism exists. Possessing a vault recovery key does not bypass that flag.

## Review requirements

No production-security claim is made. Review client/server-delivered JavaScript integrity, XSS/CSP, dependency/WASM provenance, key wrapping/context binding, nonce use, master/recovery rotation, shared-key transfer, stale/rollback behavior, browser locking/clipboard policies, host permissions/TLS and KDF latency/memory. The backend remains trusted to serve honest code and enforce authorization; malicious delivered JavaScript can steal a master password during entry. Revocation cannot recall already copied information.

[Node Argon2](https://github.com/ranisalt/node-argon2) · [hash-wasm](https://github.com/Daninet/hash-wasm) · [noble-ciphers](https://github.com/paulmillr/noble-ciphers) · [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
