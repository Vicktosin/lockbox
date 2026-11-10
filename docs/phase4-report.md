# Phase 4 — Google Drive implementation report

Implemented the real Google Drive REST API v3/OAuth integration, encrypted backend token storage, bidirectional three-namespace sync and Settings controls. No Google account is connected in this environment because a developer-owned application registration/credentials have not been supplied. No fallback pretends otherwise.

## User experience

The administrator pastes a private folder link in Settings, selects Connect Google Drive and approves Google's consent. Lockbox validates the account/folder and manages uploads/downloads automatically. The wife synchronises through her own Lockbox account, without Google credentials/access. No Cloud Console, project, API key/secret, environment change, database command or manual file transfer is assigned to household users.

Settings includes actual connection status, selected folder/account, last successful sync, namespace revisions/pending sync, Sync Now, Disconnect and conflict review. A live workspace indicator replaces stale no-cloud labels. Authenticated locked users can open cloud settings without decrypting vaults.

## Backend implementation

- Google web-server authorisation-code flow, offline access, PKCE S256, random ten-minute one-use state bound to the current administrator session.
- Strict callback/query/body validation, exact configured redirect, existing cookies/session/CSRF/Origin protections, no code/token/body/URL logging.
- Actual REST token exchange/refresh/revocation and Drive account/folder/file APIs through native fetch; test transport injection is not a runtime mock.
- Owner-only private My Drive folder validation, writable capability check, trashed/shared/public/non-owned folder rejection and resource-key support.
- Encrypted create/read, paginated file identification/listing, preallocated IDs, and guarded conditional update/trash methods. Every file read/update/trash checks folder/application/kind. No permission-publication endpoint is called.
- Tokens and pending PKCE/folder attempts encrypted with standard HKDF/native AES-GCM using the existing protected server key, database identity and purpose/connection-epoch binding. No new vault key scheme.
- Expiring lease, in-process single-flight sync/refresh, HTTP timeouts/body bounds, bounded retry/backoff/jitter, persistent error/retry/checkpoint state and durable upload IDs.
- Disconnect clears credentials locally before remote revocation, aborts in-flight provider work and cannot be undone by an old callback/refresh. Even corrupt stored tokens can be cleared. Unconfirmed Google revocation is reported explicitly.
- Startup migration automatically makes an encrypted pre-upgrade backup, validates immutable history and applies pending schema. Existing database/key requirements and fail-closed permissions remain.

## Sync and privacy

Personal namespaces are bound to their distinct account IDs; the Household namespace is bound to its shared vault ID. Personal snapshots carry only the user's already wrapped Phase 3 profile and encrypted document. The shared snapshot carries its encrypted document/key check plus server-authoritative membership. Account hashes/sessions are not uploaded.

Client credential/folder encryption and master/recovery wrapping remain unchanged. The backend never receives/decrypts master passwords or unwrapped vault keys. An outer server-authenticated encryption layer protects cloud metadata/ACL records under a domain-separated derived key; the protected server key is never uploaded.

Immutable snapshot files publish before an immutable commit referencing their hashes/IDs and prior commit hashes. Each commit describes a complete consistent three-namespace set. Sync never overwrites existing committed payload/head files and does not depend on Drive last-writer-wins or conditional-write support.

Per-namespace checkpoints detect local-only, remote-only and both-sided changes. Safe disjoint changes can merge; divergent cloud heads and overlapping edits create preserved conflicts. A fresh local fingerprint is rechecked inside the import transaction, so a save arriving during network I/O is never overwritten. Uploaded objects remain preserved if publication races.

Conflict resolution requires every registered household account to approve the same complete local/cloud copy. The administrator cannot approve the wife's private-vault replacement. Changed copies invalidate old approvals. Resolution appends a commit joining the branches; earlier snapshots remain. No automatic plaintext/field-level merge or blind newest-timestamp overwrite is used.

Cloud imports atomically update encrypted profiles/documents/membership and revoke current sessions. Users sign in/unlock again to discard stale keys and avoid revision ABA when choosing an older copy. Normal central-backend uploads do not sign users out.

Status responses never expose Google tokens, client secrets, other-user private ciphertext or the administrator's Google identity to the wife. Existing Personal read/write restrictions and Household key-sharing/grant/revocation remain active.

## Migration and files

New immutable migration: server/database/migrations/0004_google_drive.sql.

Tables: drive_connection, drive_oauth_states, drive_checkpoints, drive_objects, drive_commit_cache and drive_conflicts. Connection secrets/attempts/conflict details use authenticated encrypted records; content hashes/file IDs/checkpoints contain routing metadata only.

Created:

- server/drive/config.ts — developer registration validation.
- server/drive/security.ts — standard server sealing, canonical fingerprints, safe errors and folder-link validation.
- server/drive/provider.ts — production REST adapter and bounded transport.
- server/drive/snapshots.ts — exact Phase 3 snapshot validation/export/import.
- server/drive/service.ts — OAuth, refresh, scheduler, immutable sync/approval/reconnection lifecycle.
- server/drive/routes.ts — protected user-facing routes and callback.
- server/database/upgrade.ts — automatic backed-up startup upgrades.
- shared/drive.ts — public status contract with no secrets.
- src/features/drive/drive-settings.tsx and sync-indicator.tsx.
- scripts/check-drive.mjs and google-drive-fixture.mjs — tests only.
- docs/phase4-report.md.

Modified:

- server/index.ts, server/http/app.ts, server/auth/routes.ts and server/vault/routes.ts — integrate real routes/scheduler while preserving existing security.
- server/maintenance/backups.ts — staged restore clears all Google grants/attempts/sync caches and conflicts.
- server/.env.example — commented deployment-only credential names; no secrets.
- src/app/App.tsx, src/features/vault/vault-gate.tsx, src/components/layout/app-shell.tsx, src/features/dashboard/dashboard.tsx, src/features/credentials/credential-library.tsx and src/index.css — Settings, locked access, live status and accurate labels without redesigning the dashboard.
- scripts/check-frontend.mjs and package.json — new UI coverage and test:drive.
- README.md, server/README.md, src/features/README.md and current architecture/security/data-model/operations/roadmap/Drive documentation.

No dependency was installed or upgraded. Existing migrations, client cryptography, key-file/ACL implementation and login/session implementation were not replaced. The inactive legacy storage scaffold remains only for backward-compatible boundary tests; it is not the production Drive adapter.

## Verification

| Check         | Result                                            |
| ------------- | ------------------------------------------------- |
| test:drive    | 20 passing                                        |
| test:frontend | 23 passing                                        |
| test:backend  | 12 passing                                        |
| test:auth     | 13 passing                                        |
| test:vault    | 14 passing                                        |
| test:storage  | 4 passing                                         |
| typecheck     | Frontend/build-config/backend pass                |
| lint          | Pass, zero warnings                               |
| format:check  | Pass                                              |
| build         | Production Vite/PWA preparation/worker build pass |

Total: **86 passing automated tests**.

Drive coverage uses actual local encryption, SQLite, Fastify routes and real REST adapter parsing against mocked Google responses. It covers registration unavailability, PKCE/state/session binding/replay/expiry/cancellation, privacy/ownership/writability/resource keys, encrypted three-namespace upload/download, wife-side isolation, conditional methods, refresh/401/single-flight, lost-response idempotence, network retries, concurrent local/cloud writers, preserved conflicts and independent account approvals, tamper rejection, disconnect during OAuth, reconnect/invalid grants/corrupt tokens, automatic route-triggered sync, restored-token deletion and SQLite/WAL/log plaintext absence.

Frontend coverage adds unavailable-registration guidance without credential fields, real Google authorisation navigation, connected state only after simulated callback, Sync Now and Disconnect retaining local ciphertext. All previous account/vault/recovery/clipboard/demo regression scenarios remain. No weaker cipher/KDF or live vault mock replaces production code.

The real backend was started against the existing local database. Startup automatically upgraded to migration 4 after an encrypted pre-upgrade backup, and health reported the existing client-encrypted engine ready. Unauthenticated Drive/vault state requests were rejected. No real Google credentials/passwords were used or accounts/vaults seeded. The temporary backend process was stopped.

## External developer-side dependency

The developer/deployer must register a confidential Google OAuth web application, enable Drive API v3, register the exact callback and supply backend-only client credentials. Applicable Google production verification/security assessment, consent branding/privacy information and deployment HTTPS belong to that work.

The requested paste-existing-folder UX uses the broad drive scope because drive.file alone cannot authorise arbitrary pasted folders without Picker/app-file selection. Code confines operations to the selected folder, but a stolen broad-scope token can access more of that Google account. This is a material deployment/security-review tradeoff.

None of this work is delegated to the household user. With no registration supplied, the integration remains visibly unavailable/unconnected rather than fabricating a connection. Live Google consent, quota behaviour, revocation and conditional-maintenance methods have not been verified with a real registered client here.

See [the deployment and protocol guide](google-drive-integration.md) for exact settings/references.

## Limits and independent review

- Existing server/database identity and protected key versions are required to read the authenticated cloud collection. Drive does not replace account-database/key backups or restore unrelated fresh account IDs automatically.
- Account-login recovery remains unimplemented. Staged restored accounts stay reset-required; do not bypass the flag. A complete production account-plus-vault disaster restore is not yet certified.
- Whole-copy conflict selection needs all registered accounts to agree. It preserves versions but is not a field-level merge; an unavailable account can delay resolution.
- Imports sign existing sessions out intentionally. A single central backend normally uploads its own changes and avoids that interruption.
- Histories are immutable and capped at 10,000 listed files/100 pages; automatic retention/compaction and a past-version browser are not implemented. Do not manually remove referenced cloud history.
- A malicious Google owner can delete/replay an old valid collection. Authentication detects corruption, not an independent global freshness anchor after a complete local/cloud rollback. Missing history stops safely.
- Conditional update/trash exist for the adapter but are not used by sync; live Drive ETag semantics must be validated before relying on those methods operationally.
- Browser-delivered JavaScript/XSS, broad OAuth scope, token storage, secret/old-key retention, callback/proxy logging, sync races and shared-key/ACL coupling require independent security review. Automated tests do not establish production security.
- Real-browser Google UI/worker/mobile checks require deployment/live credentials. No PWA registration, offline browser persistence, Chrome extension, Supabase or Google Sign-In was added.

## Exact next development phase

**Phase 5: production deployment and recovery validation.** Developer-owned Google registration/verification and live end-to-end testing; independently verified username-only account recovery; guided complete account/key/Drive restoration; crypto/application review, HTTPS/CSP/proxy hardening and tested history retention. Continue implementing those concrete features/validations without recreating the application.
