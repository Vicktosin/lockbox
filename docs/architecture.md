# Lockbox architecture

Phase 7: [current release validation](phase7-release-validation.md) records actual Chrome/Edge runtime and private Caddy evidence, internal fixes and outstanding live Google/UI/physical-device/systemd/independent-review gates. Historical phase statements are not present-release certification.

Phase 6 update: [Current release assessment and recovery rehearsal](phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Phase 5 update: [Recovery and production preparation](phase5-recovery-production.md) is the current authority for login recovery codes, complete encrypted backups, safe restoration, retained history and deployment templates. Older deferred-recovery/database-only descriptions below are historical where superseded. Live Google validation and independent review remain outstanding.

Phases 1–4 are implemented: backend foundation, authentication, client-encrypted vaults and Google Drive OAuth/synchronisation. A real Google connection still requires developer-owned application registration; none is connected in this environment. The existing interface/design is preserved, and the old demo remains only for regression tests.

## Current system

One React/TypeScript/Vite frontend and one Node 24/Fastify/SQLite backend share an origin. Production requires HTTPS; local development uses Vite's API proxy and a loopback backend. No Supabase, Google Sign-In, Drive connection, Redis or mandatory MFA is introduced.

Account registration/login retain Phase 2 Argon2id hashes, private invitations, unique canonical usernames, HttpOnly digest-backed sessions, expiry, revocation, rate limits, exact-Origin and CSRF controls. The login password authenticates the account. It is independent of the master password.

The **master password never goes to the backend**. Browser Argon2id derives a wrapping key using a random salt and a fixed 64 MiB/time-3/parallelism-1 profile. A random account root key is wrapped independently by that key and a random 256-bit recovery key. The root encrypts a keyring containing independent random Personal and optional Household encryption keys. Only wrapped keys/ciphertext and public format/routing metadata reach SQLite.

Client encryption is XChaCha20-Poly1305 through @noble/ciphers, with fresh 24-byte random nonces and authenticated user/purpose/vault/revision context. No custom cipher or password hashing is implemented. The earlier server-side saved-data AES proposal is superseded; Phase 1 native AES-GCM encrypted backups/key-file protections remain unchanged.

## Persistence and access

New migration 0003 adds client_vault_profiles, client_vaults and client_vault_members. The existing migrations, account/session tables and reserved Phase 1 credential tables stay intact. Real vault APIs use the new ciphertext tables only.

Each Personal vault is server-scoped to its authenticated owner and has its own client key. One Household vault is independently keyed. Its owner grants the other account membership and privately transfers its high-entropy Household key. The recipient verifies that key locally, then wraps it under their own root key and joins. Login or possession of a folder/vault ID is insufficient.

Household contents are deliberately collaborative: joined accounts can read/edit/delete/move shared credentials and folders. Only the Household owner grants/removes account access. Removal atomically rotates the key/check/ciphertext, updates the owner's encrypted keyring and removes membership. Copied plaintext and old snapshots cannot be recalled. This replaces the unused per-item owner-only mutation proposal; it was never an active API. No hidden administrator private-vault override exists.

A complete Personal or Household document is encrypted before each save, including credential names, URLs, usernames, passwords, notes, categories and folders. Revision comparisons reject stale writes; moves between scopes update both ciphertext documents atomically. This simple snapshot model fits two users and avoids plaintext indexes or partially encrypted records.

## Unlocking, recovery and locking

Setup requires master confirmation and re-entry of the complete generated recovery key before persistence. Reload starts locked. Settings changes a master password only after checking its current value; existing credential ciphertext stays unchanged. Recovery requires account authentication plus its recovery key, replaces the master wrapper and rotates the recovery key after verification. Login recovery remains deferred; vault recovery is not an account-login bypass.

Unlocked key buffers/documents are memory-only. Manual lock, logout, page exit and five-minute inactivity clear the engine and unmount decrypted screens; deadlines are checked when returning from background/suspension. Clipboard clearing is attempted after 30 seconds and on lock, preserving unrelated contents where readable. Browsers may block clearing and OS history cannot be erased. JavaScript memory erasure is best effort.

## Operations and limits

Normal startup requires the existing database/matching protected key and automatically applies pending checksummed migrations after an encrypted pre-upgrade backup. Staged restore clears sessions, account tokens, Google grants/attempts/checkpoints and marks accounts reset-required. Account-login recovery remains unimplemented; a vault recovery key does not bypass that flag.

Drive now stores/synchronises three independent encrypted namespaces through the administrator's backend-only OAuth connection. Immutable snapshots/commits preserve concurrent versions; private-vault conflict replacement needs each account's approval. Existing Phase 3 encryption/keys remain, with server-authenticated cloud metadata under the existing protected key. The wife uses Lockbox without Google credentials. See [the implemented protocol/developer dependency](google-drive-integration.md).

The ordinary setup is folder link → Connect → Google consent. No user Cloud Console, credential/environment edit, database command or manual file transfer is required. Missing developer registration leaves the UI truthfully unavailable. Offline browser persistence, PWA registration, Chrome extension, Supabase and Google Sign-In remain inactive.

Independent review is required for the key hierarchy/envelopes, recovery, shared-key transfer/rotation, browser memory/clipboard behavior, server-delivered JavaScript/XSS risk, dependency provenance and production HTTPS/CSP. Passing tests is not production security certification.

[Phase 3 report and format](phase3-report.md) · [account security](authentication-security.md) · [database model](authentication-data-model.md) · [operations](operations.md) · [backend guide](../server/README.md) · [roadmap](implementation-roadmap.md)
