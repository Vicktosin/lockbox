# Google Drive encrypted storage and synchronisation

Phase 7: [current release validation](phase7-release-validation.md) records actual Chrome/Edge runtime and private Caddy evidence, internal fixes and outstanding live Google/UI/physical-device/systemd/independent-review gates. Historical phase statements are not present-release certification.

Phase 6 update: [Current release assessment and recovery rehearsal](phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Current Phase 5 recovery/backup/deployment details: [guide](phase5-recovery-production.md). Google remains unconnected and live validation is pending.

Phase 4 implements the Google Drive API v3 provider, real server OAuth flow, encrypted tokens, bidirectional synchronisation and Settings controls. It replaces the previous optional-backup-only plan. No Google account is connected in the development environment: a developer-owned Google application registration has not been supplied.

## Household-user experience

The administrator opens Google Drive in Settings, pastes a private folder link, selects Connect Google Drive and approves Google's consent page. Lockbox validates the account/folder, stores encrypted backend tokens and starts sync automatically. No Cloud Console, project, API key, secret, environment edit, database command or file transfer is part of this user flow.

The wife uses her own Lockbox account. She can use Sync Now and synchronise her Personal/shared vaults through the backend without receiving Google credentials or access to the administrator's Google account. Connection/disconnection remains administrator-only.

Settings shows configuration availability, actual connection/account/folder, last successful sync, pending/error/conflict states, Sync Now and Disconnect. The workspace indicator reflects status instead of assuming a connection. Authenticated locked users can open Google Drive settings without decrypting vault data.

A folder link does not grant API access. Until deployment registration exists, Connect is unavailable and the UI says the maintainer must enable it. There is no fake-connected fallback.

## Developer/deployer dependency — not household setup

The developer must register a confidential Google OAuth web application, enable Drive API v3, configure consent/branding/privacy information and complete Google's applicable production verification/security-assessment requirements. Register the exact callback LOCKBOX_APP_ORIGIN/api/drive/callback; the local development default is http://localhost:5173/api/drive/callback. Production requires the configured HTTPS origin.

Supply LOCKBOX_GOOGLE_CLIENT_ID and LOCKBOX_GOOGLE_CLIENT_SECRET only through backend deployment secret configuration. Never VITE_ variables, source control, browser storage or a household-user form. The backend validates missing/partial configuration; both absent leave the working local application available with Drive clearly unavailable.

The paste-any-existing-folder experience uses https://www.googleapis.com/auth/drive. The narrower drive.file scope requires app-created/opened/Picker-authorised files and cannot grant access to an arbitrary pasted folder by itself. The broader token technically grants broader Drive capabilities; application code confines file operations to the selected folder. This tradeoff and the associated Google verification requirements must be reviewed before release. No Google Sign-In account authentication is introduced.

References: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [token best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Drive permissions](https://developers.google.com/workspace/drive/api/guides/manage-sharing).

## OAuth and token protection

The consent request uses the supported authorisation-code flow, offline access, consent and PKCE S256. A random one-use state is digest-stored, expires in ten minutes and is bound to the administrator's current server session. The verifier/folder attempt are encrypted in SQLite. The callback consumes state before token exchange, validates granted scope/offline access and confirms the attempt/session/connection epoch still match.

Folder validation requires a private, owner-only My Drive folder owned by the authorised account, writable and not trashed. Shared drives, public/domain sharing and folders shared with non-owners are rejected. No permissions are made public or modified.

Access/refresh tokens are backend-only, encrypted using a standard HKDF-derived subkey of the existing protected server key and native AES-256-GCM. Context binds database identity, token purpose and connection epoch. Refresh is single-flight; invalid grants require reconnection. Disconnect clears local credentials/pending attempts first, aborts provider requests and attempts Google revocation. Failed remote revocation is reported; corrupt tokens can still be cleared locally. An old callback/refresh cannot resurrect a disconnected connection.

No master password, vault key or login password enters Google OAuth requests. User-facing responses and allowlisted logs never expose tokens, client secrets, verifiers or OAuth callback URLs/bodies.

## Three namespaces and cryptographic boundaries

Snapshots are independent for personal:administratorId, personal:partnerId and household:householdVaultId. Personal snapshots contain that account's already wrapped Phase 3 profile plus its encrypted Personal document. The shared snapshot contains the encrypted Household document/check and server-authoritative membership records. Account login hashes and sessions are not uploaded.

All credential/folder fields were encrypted in the browser before SQLite persistence. The backend never decrypts them. Client master/recovery/Personal/Household keys and wrapping remain unchanged. A second server-authenticated encryption layer protects cloud metadata/records and membership integrity using the existing protected server key; that key is never uploaded.

Namespace validation checks account IDs, scope, owner IDs, revisions and exact Phase 3 envelope/KDF formats. There is no arbitrary Drive-file download endpoint, impersonation field or administrator private-vault read override. Wife-side status exposes only her Personal/shared metadata, not administrator ciphertext or Google tokens.

## Sync protocol

SQLite remains the local durable cache/account authority. Changes schedule a debounced sync after 1.5 seconds; the backend also polls every minute. Temporary errors use bounded exponential retry/jitter and persist retry state. Sync Now triggers the same worker. A durable expiring SQLite lease and in-process single-flight guard prevent duplicate local jobs.

File IDs are preallocated and recorded before upload. Lost create responses are retried with the same ID; a duplicate-ID response is authenticated/read back instead of creating duplicate commits blindly.

Snapshots and commits are immutable. Each encrypted commit references complete snapshot hashes/IDs and parent commit hashes. All required snapshots upload before the commit is published, so keyring/shared-key/membership changes become visible together. Older data is not overwritten. Cache entries are authenticated and keyed by Drive file version; listing identifies Lockbox files by application/kind/hash properties in the selected folder.

Per-namespace checkpoints compare local and remote content. One-sided updates upload/download; disjoint namespace changes can merge automatically. Both-sided changes or multiple concurrent heads become explicit conflicts. Local changes arriving during upload are retained and flagged. Import checks the captured local fingerprint inside an immediate transaction; it never blindly overwrites a newer local save.

Conflict copies remain preserved in Drive. Each registered household account must approve the same complete local/cloud copy before resolving; the administrator cannot approve replacement of the wife's private vault. Stale approvals are discarded when copies change. Resolution publishes a commit joining the heads, retaining history. It is copy selection, not a plaintext field-level merge.

A cloud import updates encrypted profiles/documents/membership atomically and revokes existing sessions. Signing in again and master-unlocking prevents stale decrypted keys and revision ABA, including explicit selection of an older copy. Ordinary uploads from the central backend do not sign users out.

## Adapter operations and limits

The REST adapter supports folder/account validation, paginated identification/listing, generated IDs, encrypted create/read and conditional update/trash with parent/application/kind checks. Sync itself never mutates or trashes committed history and does not rely on undocumented last-writer-wins/ETag behaviour. Conditional maintenance methods refuse missing/mismatched ETags; live Google behaviour remains an external validation gate.

The current cap is 10,000 listed files and 100 pages per listing, with bounded response sizes and timeouts. History compaction/retention and a previous-version browser are not implemented. Missing/tampered history stops safely instead of inventing an empty vault or deleting local data.

## Deployment, recovery and remaining verification

The existing database ID/account identities and protected server key must persist across deployments. A cloned/restored installation with those identities can initially download cloud vault state. A fresh unrelated account database/key is a different installation; a folder link or master password alone cannot restore account records/server cloud metadata. Maintain encrypted account-database backups and a separate protected key backup as developer/operator responsibilities, not manual user file transfers.

Startup now applies pending migrations after an encrypted pre-upgrade backup; users do not run database commands. Staged restore removes Google tokens, pending OAuth states, checkpoints/caches/conflicts so old grants cannot revive. Account-login recovery is still deferred and restored accounts remain reset-required; Phase 5 must implement/test account recovery before a complete production disaster-recovery claim.

Real Google consent, verification, quota/conditional-write behaviour and browser deployment require developer credentials and live testing. All automated Google responses are mocked. The local vault, API adapter and sync engine are real implementations. Independent application/cryptographic review and production HTTPS/proxy callback-log redaction remain release gates.

[Phase 4 report](phase4-report.md) · [architecture](architecture.md) · [operations](operations.md)
