# Phase 5: recovery, backups and production preparation

Phase 6 update: [Current release assessment and recovery rehearsal](phase6-release-assessment.md) supersedes earlier deferred off-device/compaction/helper descriptions. Automatic verified encrypted Drive backups, archived-history retrieval and a private recovery assistant are implemented. Live Google, actual production ingress/browser validation and independent review remain outstanding; no public deployment or production-security certification is claimed.

Implemented locally; **not approved for real credentials or public deployment**. Automated tests are not an independent security assessment. Google responses are mocked; there are no developer Google credentials or live Google validation results in this environment. No public deployment was made.

This document supersedes earlier deferred-login-recovery and database-only backup descriptions. Phase 3 client cryptography and Phase 4 OAuth/immutable cloud sync remain in use. No packages, services, Supabase, Google Sign-In, mandatory MFA or alternative master-password system were added.

## Household instructions

1. Each person opens Settings → Login recovery, enters their current **login** password, and generates a login recovery code. Save it privately outside Lockbox. Generating another invalidates the previous code. A complete backup will not report success until both active accounts have unused codes.
2. Keep your separately generated **vault recovery key** outside Lockbox. It unlocks encrypted vault keys locally; it is never a login-reset token.
3. The administrator opens Settings → Backups and recovery, enters their login password and saves the **emergency backup key**, separately from backups. This key decrypts the complete application backup, including protected server material. Treat it as a highly sensitive household-wide emergency secret. It cannot independently decrypt a master-protected personal vault.
4. Check the last verified backup. Backups run daily while the backend is running; Back up now uses the same verified path. A maintainer must arrange automatic off-device copying of encrypted backup files and a separately secured emergency-key record. Local-only files do not survive loss of this computer.

No household member configures Google Cloud, environments, TLS, databases or services. The maintainer provisions deployment, copies encrypted backups off-device and operates clean-install restoration. A guided household self-service disaster restore wizard is not implemented.

## Recovery rules

| Situation                                        | Implemented route                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forgotten login password                         | Sign in → Recover login; enter username, saved login recovery code and a new confirmed password. The code is consumed once, all sessions and pending account tokens are revoked, and the user signs in again. Vault ciphertext/wrappers are unchanged.                     |
| Lost login recovery code, working login          | Generate a replacement in Settings with current-password reauthentication.                                                                                                                                                                                                 |
| Login password and login recovery code both lost | No automatic recovery or partner override. Verified maintainer identity-assisted account recovery is not implemented; do not edit reset flags or substitute the vault key.                                                                                                 |
| Forgotten master password                        | Existing locked-vault recovery verifies the vault recovery key locally, rewraps the existing root with a new master password and verifies a replacement recovery key before committing. Personal and Household access survive.                                             |
| Lost vault recovery key, master known            | Settings → replace recovery key; prove current master locally and type REPLACE. Save the displayed replacement; old current-profile recovery key stops working.                                                                                                            |
| Master and vault recovery key both lost          | Personal decryption cannot be recovered. Login reset, Google, the administrator and the emergency backup key cannot bypass it. A still-unlocked trusted device may permit export/recovery before locking. A partner with a working Household key can preserve shared data. |
| Session expired, revoked or lost                 | Sign in again; unlock separately. Failed-login limits expire after 15 minutes. Successful code recovery clears the account-name login limit; IP abuse limits remain. No permanent automatic account deactivation.                                                          |

Login recovery uses 256-bit cryptographically random codes, domain-separated SHA-256 digests, case-insensitive lookup, strict schemas, generic failures for unknown/wrong codes, rate limits, bounded Argon2 concurrency and transactionally consumed proof. Reset hashes new login passwords using existing Argon2id 64 MiB/time 3/p1. Code generation needs a session, CSRF and current login password. Codes are intentionally saved long-term, single-use bearer secrets rather than email-link tokens; rotate after use/exposure. They do not expire silently while a household depends on them. Existing codes stored in old database backups can reappear after rollback; a recovery drill must rotate codes afterward.

Recovery principles follow [OWASP password-reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). There is no security-question, email, Google-login or hidden vault reset flow.

## Complete backup and restore format

Migration 0005 adds login_recovery, vault_history, maintenance_policy and backup_runs. The existing migration checksum system and protected pre-upgrade backups remain unchanged. A trigger captures each replaced client vault payload in the same SQLite transaction, including downloads/conflict imports.

The new complete archive uses the established native AES-256-GCM authenticated archive implementation with an **independent random 256-bit emergency key** and random 96-bit IV/128-bit tag. This is not derived from a login/master password or from a key contained inside the archive. The versioned authenticated payload contains:

- A consistent SQLite backup: accounts, encrypted profiles/documents, membership, history, conflicts, checkpoints and connection metadata.
- The exact protected versioned server-key file, with a SHA-256 integrity entry.
- Required portable application configuration: origin and optional Google confidential-client credentials; paths are remapped during clean restoration. Schema/migration history and database identity are inside SQLite.
- Database hash, format and creation time. Application source, Node/package versions and migrations are deployed separately using the matching release/package lock; they are not executable backup contents.

The emergency key is kept at a protected recovery/disaster.key sibling of the configured keys directory, **outside the backup directory**. All staged and final files retain existing ACL/mode checks; no protections are relaxed. Missing keys with existing complete archives fail closed rather than silently generating a replacement. Configuration errors, failed integrity checks, insufficient recovery proofs, oversized state (48 MiB database / existing 64 MiB authenticated payload bound), disk/permission errors or missing key versions cannot produce a verified backup.

Each backup performs: SQLite snapshot → package database/keys/config → encrypt → decrypt and restore into a private isolated directory → migration/checksum/key-binding/SQLite integrity/foreign-key checks → persist encrypted file → read/authenticate it again → verified tracking. Temporary staging is removed after completion/failure. Crash-interrupted private stages and quarantined failed restore targets require maintainer inspection; never treat them as verified archives. Backups are single-flight within the supported single backend process. Multiple backend processes against one database are unsupported.

Restoration targets an empty directory and never replaces a live database. The restored database preserves encrypted data, account IDs, permissions, revision/conflict history and Google folder/checkpoint metadata. It **deletes sessions, invitation/reset tokens and pending OAuth attempts**, clears stored Google access/refresh grants, assigns a fresh connection epoch, clears sync leases and requires Google reconnection. Existing Google grants should also be revoked by the maintainer if compromise is suspected. Accounts are reset-required and recover with the codes saved when the backup was made; this is not an authentication bypass. The emergency key is copied into the protected restored installation for subsequent backups.

The maintainer-only utility is:

```sh
npm run recovery:restore -- /secure/archive.lbx /separate/saved-emergency-key /empty/absolute/installation
```

It produces a protected deployment.json and restore-status.json. The maintainer starts the matching application release with LOCKBOX_DEPLOYMENT_FILE pointing to deployment.json. Production still validates HTTPS and storage paths outside the source/public tree. Reconnect Drive from Settings; rotate both login recovery codes, verify vault recovery keys, and perform a new complete backup before retiring the source archive. Reconcile remote history through normal conflict approvals. Old approvals/history remain evidence; fresh cloud changes are checked before resolution.

The original database-only archive/CLI remains backward-compatible; it is **not** a complete disaster recovery bundle and still needs its original server-key file.

## Retention and deleted entries

Administrator Settings configures backup retention (7–365 days, default 30) and history window (7–3650 days, default 90). A newly verified backup triggers expiration of old tracked verified complete archives, always retaining the two newest verified copies. Unknown/untracked files, migration backups and failed artifacts are never blindly deleted.

Unique historical ciphertext is pinned. Only byte-identical duplicates of the same namespace/revision may expire after the history window; at least one survives. Deleted credentials remain within earlier encrypted vault revisions. Settings → Recover deleted entries lists the latest 100 authorised revisions and recovers missing entries/folders locally into a new encrypted revision, preserving current entries/passwords. It does not restore membership or overwrite live data. Historical documents under a retired key require the corresponding older complete backup/profile and master/recovery secret; the current key cannot decrypt them.

**Limitation:** configurable destructive retention of unique revisions, deleted-only records and competing cloud heads is deliberately not enabled. The server cannot inspect opaque credentials to prove a later encrypted copy contains them. Cloud DAG compaction requires reachability, independent owner approval, key-generation compatibility and verified off-device archival before deletion. No competing cloud branch or unique recoverable credential is removed to satisfy a retention timer. Immutable cloud history still has Phase 4's listing limits; storage can grow. This part of production retention remains unfinished and is a release blocker for long-term use.

## Security findings and fixes

- Added missing independently verified username-only login recovery, preserving separation from vault decryption; reset cannot rewrap vault keys or grant Household membership.
- Closed incomplete-disaster-backup gap: protected keys/config now accompany SQLite inside separate-key encrypted, actually restored bundles. Recovery prerequisites and missing backup keys fail closed.
- Added encrypted deleted-entry history and cross-account API controls; only the owner of a Personal vault or a currently joined Household member can fetch its history. Removal revokes history access too. No plaintext history, recovery codes or emergency keys are logged/persisted in browser storage.
- Backup administration is administrator-only and CSRF/Origin protected. Emergency-key disclosure additionally requires current login password. Wife receives neither Google tokens nor emergency backup key through the API.
- Added same-origin HTTPS reverse-proxy/static CSP template (including explicit WASM allowance for Argon2), no-store/HSTS/frame/content-type/referrer/permission headers, secret-free logging and a restricted single-process service template.
- Preserved vetted KDF/ciphers/wrapping, strict request/decrypted-document validation, parameterised queries, revision transactions, cookie expiry/revocation, protected file permissions and safe OAuth state/PKCE/refresh handling. No custom cryptographic algorithm introduced.

Remaining risks: login/recovery throttles are process-local; a restart resets budgets (codes have high entropy, hashes retain bounded concurrency). Both passwords/codes lost still requires an unimplemented verified assistance policy. Server-controlled JavaScript/XSS can steal unlocked keys. Memory/clipboard erasure has browser/OS limits. Old backup holders can retain old credentials/recovery wrappers; global rollback has no external freshness anchor. A compromised emergency key exposes server grants/config and account verifiers in archives, although client master encryption remains. Off-device backup transport, emergency-key custody, disk exhaustion, production TLS/CSP/performance, broad Drive scope and executable release provenance require deployment validation. Browser extension is not implemented and must never inherit backend Google tokens; its future message/origin/content-script boundaries require a separate review.

## Deployment and live Google validation (maintainer only)

deploy/Caddyfile and deploy/lockbox.service are templates, not an executed deployment. Use a dedicated unprivileged OS account, protected storage outside the project, Node 24, locked dependencies and a single backend bound to loopback. Provide production origin, database/key/backup paths and optional Google credentials through a protected service environment or restored configuration. Provision database/key/invites using existing maintainer tools; household users only use the interface. Caddy or an equivalent existing ingress terminates HTTPS and serves the frontend and /api on one origin. Never serve server/, .env, key/backups or restored deployment files. Do not enable query/body logging at the proxy or monitoring layer. API readiness is /healthz; startup checks configuration, migrations and key/database binding. Signals await maintenance/Drive shutdown before closing SQLite. Review service stop deadlines against real backup sizes.

The existing Drive test suite covers consent/state/PKCE/callback binding, refresh/revocation, permission checks, encrypted three-namespace uploads/downloads, initial and automatic sync, simulated devices/writers, independent Household approvals, network interruption, reconnect and grant removal. It uses mocked Google responses through the real REST adapter, not a runtime mock.

**Live Google checks have not run.** The developer must register/verify the confidential Google application, enable Drive API v3, supply backend-only credentials and exact HTTPS callback, and validate consent, refresh/revocation, folder permissions, ciphertext, two browsers/accounts, sync, racing writes, interrupted networks and reconnection with disposable test accounts/folders. No real household credentials are appropriate during this test. Record dates/results/evidence in a separate live-validation report and inspect Drive files for plaintext. Google registration/verification and independent security review remain developer-side release dependencies.

## Completion and next work

New checks: npm run test:recovery. Existing backend/auth/vault/Drive/frontend/storage regressions, TypeScript, ESLint, Prettier and production build remain required. No automatic test constitutes certification.

Next phase: **Phase 6 — release-blocker closure and verified deployment rehearsal**: developer Google registration and recorded live checks; guided maintainer recovery workflow and lost-all-login-proof policy; verified automatic off-device backup delivery/key custody; bounded cloud-history compaction; real-browser/mobile/CSP/performance validation; independent application/crypto review and fixes. Public exposure still needs explicit approval. The owner eventually saves the clearly distinguished recovery material and approves Google consent, without developer-console or database work.
