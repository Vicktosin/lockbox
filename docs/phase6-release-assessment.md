# Phase 6: release-blocker closure and verified rehearsal

Status: implemented and verified locally using fictional accounts and mocked Google responses. **Not a public deployment, a live Google validation or independent security certification. Real credentials remain blocked pending the external checks below.**

## Implemented release blockers

- Complete encrypted backups now deliver automatically through the real Google Drive REST adapter into a separately selected private backup folder. Cloud uploads contain encrypted data only. OAuth tokens/client secrets stay on the backend; master passwords/unwrapped vault keys stay on the client. The emergency key is revealed only to the reauthenticated administrator over the protected connection and is never uploaded.
- The administrator connects Google normally, selects a different private backup folder in Settings and confirms the emergency key saved separately. The backend validates ownership/writability/privacy, reuses the administrator's server-side OAuth grant and never gives it to the wife.
- Backup uploads use resumable 1 MiB chunks, strict Google upload-location validation, bounded progress checks, existing refresh/retry handling and preallocated durable file IDs. Restart/lost-response retries authenticate an existing completed file instead of replacing it.
- Delivery success requires download equality, authenticated decryption and an actual isolated restoration with database/key/integrity checks. Local success and remote success are distinct. Persistent delivery records/errors/retry times survive restart; the scheduler retries every minute when due. Daily source backup scheduling remains.
- Settings shows destination, verified delivery time, stale/missing protection and errors. The administrator's workspace shows a backup-attention indicator. Staleness uses the source backup's creation time, not just the time an old file was redelivered; older than 48 hours is flagged. Alerts are in-app, not email/push or monitoring of an offline server.
- A private, loopback-only recovery assistant obtains fresh Google consent without the original database, downloads an encrypted backup and restores into an empty installation. It needs the separately saved emergency record and developer-provisioned Google application, not any original server token/key/database. It never asks for master passwords.
- Recovery guidance covers forgotten login/master passwords, replacement/lost keys, lost devices, revoked Drive grants, damaged databases, server replacement and loss of all proof.
- Safe compaction transfers old local encrypted revisions to pinned verified remote complete archives; authorised history reads transparently retrieve/authenticate archived revisions. Unique/deleted-entry recovery and competing cloud heads are preserved. No destructive cloud DAG deletion occurs.

## Emergency custody and recovery boundaries

Each person saves a **login recovery code** and a separate **vault recovery key**, privately outside Lockbox. The administrator also saves an **emergency backup record** outside Google Drive containing the emergency backup key, installation ID shown alongside it, and backup-folder link. The emergency key file stays in protected server recovery storage outside backup files; it is never uploaded. An independently secured paper/offline copy prevents server loss from also losing the only decryption key.

The maintainer launches `npm run recovery:assistant -- <empty-installation> <private-workspace>` with developer-provisioned credentials. The launcher writes the one-use private launch URL (fragment capability) to protected launch-url.txt in the private workspace. It never prints that secret to stdout. The maintainer opens the protected file/link and follows the assistant with the owner; the file is removed on shutdown. Do not share it or copy it into logs. It sets a private HttpOnly SameSite cookie, enforces a 30-minute server-side deadline, strict Host/Origin/CSRF and PKCE/state, clears query data on redirect, keeps temporary Google grants only in memory and attempts revocation after restore/shutdown. Failed revocation is explicitly reported; the maintainer must review Google permissions. Wrong backup keys do not prevent a corrected retry against an otherwise empty target; partial restores remain quarantined and never overwrite live state.

The assistant restores existing encrypted IDs/data, permissions, revision/conflict metadata and configuration, invalidates sessions/old Google grants and requires each user's saved login recovery code. It reports the authenticated backup date and warns about older copies. Both users then sign in and unlock with their own master password or vault recovery key; reconnect Drive and replace consumed login codes before a new verified backup. No manual database flag changes are permitted.

| Missing factor                                                   | Recovery boundary                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login password missing, login recovery code saved                | Reset login, revoke sessions, then separately unlock the vault.                                                                                     |
| Login recovery code lost, login password known                   | Sign in and replace the code, including while the vault is locked.                                                                                  |
| Master forgotten, vault recovery key saved                       | Recover/re-wrap locally; login reset never substitutes for this proof.                                                                              |
| Vault recovery key lost, master known                            | Replace the vault recovery wrapper after local master verification.                                                                                 |
| Server/device lost, emergency record and each user's proof saved | Fresh Google consent, remote restore, account recovery and independent vault decryption.                                                            |
| Google grant revoked                                             | Local access remains; administrator reconnects. Archives need a valid fresh grant to be read.                                                       |
| Master and vault recovery key both lost                          | Personal decryption is unrecoverable unless a still-unlocked trusted device retains the key. An authorised partner may preserve Household contents. |
| Login password and login recovery code both lost                 | No automatic or partner bypass. A reviewed identity-assisted recovery policy is not implemented.                                                    |
| Original server lost and emergency key unavailable               | Complete encrypted cloud archives cannot be decrypted. Google account possession alone does not help.                                               |

No new escrow/master reset, Supabase, Google Sign-In or mandatory MFA was introduced.

## Retention and compaction guarantees

Backup retention remains configurable (7–365 days), keeping two verified local copies. An undelivered backup is not removed while off-device protection is configured. Delivered local files may expire, but their remote routing/verification records remain. Files referenced by unique archived history retain their local fallback too, even beyond the normal retention window; the rehearsal verifies this after advancing past retention. Remote archives are **not automatically deleted**; those containing compacted history are pinned indefinitely. Changing an established backup destination is refused until a maintainer performs a verified migration, avoiding broken archive pointers.

The history window (7–3650 days) controls eligibility for archiving. Compaction downloads the verified remote complete backup again, authenticates it and compares each exact historical record/digest with live SQLite inside the final transaction. Only matching, old records move into an archive index before their local ciphertext row is removed atomically. Concurrent/new records are retained. Archive lookups enforce current Personal ownership/Household membership before network work and recheck session/permissions afterward. A new trigger allocates IDs across both live and archived tables, preventing row-ID reuse.

Recovered deleted entries are re-encrypted locally into new revisions without replacing newer entries. Old key generations may require the corresponding complete archive and old master/recovery proof. The app cannot revoke copied secrets or old backup holders' access.

Competing/unresolved cloud branches and their immutable snapshots remain untouched. This is **archival compaction, not destructive cloud DAG garbage collection**. It reduces active local history storage while retaining the only recoverable credential copy remotely. Listing/remote storage can still grow, and the Phase 4 Drive listing limits still apply. WORM/object-lock protection and deletion-resistant independent backup copies are not provided by an ordinary writable Google folder. Removing remote archives manually can destroy history; the UI/guide prohibit doing so. Disk/cloud capacity and a future independently reviewed archive/DAG reclamation policy remain operational limits.

## Automated disaster rehearsal

`npm run test:rehearsal` uses the actual Fastify/SQLite/key/crypto/OAuth/Drive/backup/restore code and a mock Google REST transport. It does not contact Google or use real credentials. The mock remote store is independent of the deleted installation but remains a test process, so this is not proof of a physical off-device Google recovery.

Recorded steps:

| Step                                                                                           | Result                    |
| ---------------------------------------------------------------------------------------------- | ------------------------- |
| Two separate accounts, independent master passwords, Personal vaults and joined Household      | Passed                    |
| Google consent/state/callback, private separate backup destination and custody confirmation    | Passed with mocked Google |
| Encrypted automatic upload, remote download equality and isolated restoration verification     | Passed with mocked Google |
| Old history compaction and recovery of deleted entries; wife's Personal-history denial         | Passed                    |
| Network failure, persistent retry, lost-final-response adoption and source-date staleness      | Passed                    |
| Complete removal of original test database, server keys, local archives and sessions           | Passed                    |
| Fresh private recovery assistant bootstrap, Google consent and remote-only download            | Passed with mocked Google |
| Wrong emergency key rejected, corrected key accepted, repeat/nonempty restore refused          | Passed                    |
| Both restored accounts recover login; both Personal vaults and Household decrypt independently | Passed                    |
| Revision/archived history, membership and historical conflict fixture preserved                | Passed                    |
| Fresh Drive reconnection, archived history retrieval, new encrypted save/sync/backup           | Passed with mocked Google |

Actual competing-writer/conflict creation is separately covered by the existing Drive suite; the clean-replacement rehearsal verifies preservation of a closed encrypted conflict fixture. Existing recovery tests cover local master/key recovery for both users, consumed codes and missing keys. Full loss of proof fails closed; no test bypasses encryption.

## Security review: internal findings and fixes

| Finding                                                                         | Implemented fix/verification                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Local backup success did not prove off-device durability                        | Separate persistent delivery state; download/authenticate/restore before remote success.                                       |
| Same-folder storage and lost emergency key could undermine recovery             | Require separate private folder and full separately saved key confirmation; never upload emergency key.                        |
| Retried old delivery could look fresh                                           | Compare source creation date and flag stale/missing protection after 48 hours.                                                 |
| History row IDs could be reused after compaction                                | Immutable migration 0006 replaces trigger with allocation across live/archive IDs; rehearsal checks monotonicity.              |
| Source recovery-proof precheck could race with asynchronous SQLite backup       | Restored snapshot itself checks every active account has an unused login recovery code before backup verification succeeds.    |
| Archive access could outlive a session/membership revocation during network I/O | Authorise before download, revalidate session/membership afterward.                                                            |
| Resumable URLs/progress could leak bearer tokens or skip ciphertext             | Fixed Google HTTPS origin/path, no credentials/redirects, bounded monotonic range and size checks; adversarial unit tests.     |
| Fresh-server recovery needed old credentials/manual downloads                   | Fresh PKCE OAuth assistant and verified remote retrieval into empty paths, no master-password input.                           |
| Recovery helper could be exposed/replayed                                       | Loopback binding, Host/Origin/CSRF, one-use launch, short cookie/deadline, one-use OAuth state, bounded schemas, no HTTP logs. |
| Revocation/date assumptions could be hidden from the operator                   | Report unconfirmed revocation and authenticated source date/age after restoration.                                             |

Reviewed existing Argon2id costs/concurrency, client XChaCha20-Poly1305/AAD/wrapping, recovery isolation, session cookies/digests/expiry/revocation, CSRF/origins, parameterised queries, Household key rotation, backend token sealing, safe logging and protected file lifecycle. No cipher/KDF/permission weakening was introduced. Browser extension remains unimplemented; its future content-script/message/origin boundaries cannot be certified by this phase and must never receive Google tokens/server keys.

Remaining risks requiring independent review include browser-delivered JavaScript/XSS, memory/clipboard limits, process-local throttling, server/emergency-key compromise, broad Drive scope, old backup proof replay/global rollback, cloud-owner deletion, old key retention, recovery-helper launch capability handling, unauthenticated local malware, resource/disk exhaustion and large-backup shutdown/performance. Automated tests and internal code review are not independent assessment.

The implementation follows Google's [resumable upload protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads) and the [OWASP guidance on backups and recovery drills](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html). These references do not certify the composition.

## Deployment verification and external dependencies

`npm run test:deployment` creates an ephemeral test certificate using locally available Git OpenSSL, binds Node HTTPS **only to loopback**, trusts only that test certificate, exercises real authentication against the backend and checks Secure/HttpOnly/host-only/SameSite cookies, CSRF/Origin rejection, CSP/security headers derived from deploy/Caddyfile, private database/key files, health and shutdown. It removes its private test files. It does not install a certificate into the OS trust store or expose a public listener. Caddy is not installed here; its actual binary/configuration and Linux systemd template were not executed. Real browser/mobile/WASM/CSP behaviour and public DNS/TLS are still manual/deployment checks.

Developer/deployer must register and verify the Google confidential web application, enable Drive v3 and provide backend-only credentials. Register both exact deployment `${LOCKBOX_APP_ORIGIN}/api/drive/callback` and private recovery `http://127.0.0.1:18888/callback` as appropriate for that developer application. Do not add arbitrary redirects or share client secrets. Confirm Google permits the chosen verified consent configuration; broad Drive access is required for arbitrary existing pasted folders. The recovery assistant is a temporary maintainer tool, never a public route/service or normal owner setup step.

**Live Google status: NOT RUN.** No credentials/registration were available, so consent, quota behaviour, real resumable responses, refresh/revoke and actual cloud-only recovery have not been verified against Google. The normal app does not claim a connection. The maintainer must run and record a live disposable-data drill before real credentials: both browsers/accounts, initial/automatic sync, folder permissions, competing updates, revocation/reconnect, remote backup download and complete clean-server replacement.

Production still requires a dedicated unprivileged account, protected storage outside the project, exact HTTPS origin, one backend process, same-origin ingress/CSP, safe callback/proxy logs and migration-before-start safeguards. Existing /healthz and authenticated maintenance status support monitoring. In-app alerts cannot notify anyone while the server is unavailable; an operator must monitor host/service health separately. No additional always-on service was installed.

## Owner actions and final release decision

The owner only saves the labelled recovery material, confirms the emergency record is stored outside Drive, selects the separate backup folder through Settings and approves Google consent once the developer enables it. Both users retain their own login/vault recovery proofs. A maintainer launches and oversees clean-server restoration; nobody asks household users to configure Google Cloud, edit environments, write code or run database commands.

**Do not introduce real credentials yet.** Locally implemented blockers and mocked drills are closed, but genuine off-device Google recovery, actual production ingress/browser validation, key-custody rehearsal and independent security review are still unverified. Destructive cloud-history reclamation/deletion resistance and recovery after loss of all login proof remain deliberate limitations. Public deployment requires explicit approval.

Next work is a **live deployment/recovery acceptance run with disposable data**, developer-owned Google registration and independent security review/fixes—not another redesign or a claim that an automated green build grants production readiness.

## Files and verification inventory

Created: server/database/migrations/0006_offdevice_recovery.sql; server/maintenance/offdevice.ts, retrieve.ts and recovery-assistant.ts; src/features/settings/backup-alert.tsx and recovery-guide.tsx; scripts/check-rehearsal.mjs, check-offdevice.mjs, check-deployment.mjs, recovery-assistant.mjs and deployment-health.mjs; this release assessment.

Modified: server/drive/provider.ts and service.ts; server/auth/routes.ts; server/maintenance/complete.ts, service.ts and routes.ts; server/vault/routes.ts; src/app/App.tsx; src/features/settings/backup-settings.tsx; src/features/auth/recovery-panel.tsx; src/features/vault/history.tsx; scripts/google-drive-fixture.mjs and check-frontend.mjs; package.json; server/.env.example; deploy/lockbox.service; README/server README and current architecture/security/operations/roadmap/Drive/recovery documentation.

Migration 0006 creates backup_destination, backup_deliveries and archived_history, with strict constraints/references and an updated history preservation trigger. Existing migrations/cryptographic formats remain immutable. No package was installed or upgraded.

| Automated suite                    | Passing tests |
| ---------------------------------- | ------------- |
| Backend foundation                 | 12            |
| Authentication                     | 13            |
| Client vault encryption/Household  | 14            |
| Google Drive mocked integration    | 20            |
| Account recovery/complete backups  | 12            |
| Frontend                           | 27            |
| Legacy storage boundaries          | 4             |
| Complete replacement rehearsal     | 9             |
| Off-device transport/helper abuse  | 6             |
| Private HTTPS deployment rehearsal | 3             |
| Total                              | 120           |

Final frontend/backend TypeScript, ESLint, Prettier and the production/PWA build passed. All 120 automated tests passed. Runtime npm audit found zero known runtime vulnerabilities. Vite emitted plugin timing diagnostics during the successful build; these were performance information, not build errors or security certification. The real startup smoke test checks automatic protected migration/backup, health and unauthorized maintenance/history rejection without seeding accounts, connecting Google or publishing the application. Live Google and Caddy/systemd execution remain unverified.

Additional custody fixes: backup storage cannot overlap the emergency-key path, and a missing emergency key is not silently replaced when a cloud destination is already known. Adversarial tests cover both.
