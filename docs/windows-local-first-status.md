# Windows local-first implementation status

> Current Google integration status: [live qualification and security gates](google-drive-live-qualification.md). Preview 0.2.1 keeps ordinary-vault cloud uploads blocked; real Google testing uses separate fictional profiles. Earlier evidence below is historical.

11 November 2026. Version 0.2.0 is a controlled preview for fictional data, not a migration or release for real passwords.

## Preservation and checkpoint

The starting workspace had ten modified tracked files and the untracked Vercel audit. Before changes, 210 source files were copied with SHA-256 inventory, HEAD and status into the ignored `releases/checkpoints/windows-before-primary-1794390474417` directory. This is a source checkpoint, not a backup of account databases or native profiles. Existing private runtime data was not copied, reset, imported or migrated.

The existing Windows source/profile location is retained. Root React/Fastify/SQLite source remains available, and no server/database/key-file protection was weakened. The root README's pre-existing changes and embedded NUL were left untouched; `WINDOWS.md` supplies the primary-product entry point. No Git commit/push or Vercel deployment was performed.

Two shared frontend adjustments support reuse: an optional native clipboard transport in `src/lib/secure-clipboard.ts`, with browser behaviour unchanged by default; and backend-neutral wording in the existing credential form. All other new UI/native functionality is under the existing `proof/windows` application. The original layout/components are reused rather than replaced. No Android, iPhone or extension implementation was started.

## Implemented

| Area                | Behaviour                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows application | Bundled React/Electron runtime, secure local scheme, sandboxed renderer, narrow native IPC, no Fastify/SQLite/Vercel runtime dependency                                                                       |
| Installation        | `LockboxSetup.exe` verifies package hashes, copies into a fresh per-user version directory and creates an owner/partner Start menu shortcut; direct portable launch remains available                         |
| Existing data       | Original profile directory `AppData/LockboxFeasibilityProof-v1` and `fictional-proof.sealed` retained; new branding does not imply a data migration                                                           |
| Instance isolation  | One running process per local profile; owner and partner profiles can run independently                                                                                                                       |
| Interface           | Original dashboard/library/details/forms/generator/folder controls; real blank Add form, edit/delete/search/category/folder actions and generator-to-credential flow; no demo credential seeding              |
| Offline vaults      | Owner can create and edit a separate Household vault before cloud pairing; Personal/Household moves commit together locally                                                                                   |
| Key protection      | Existing Argon2id/root-key hierarchy, separate Personal/Household keys, master-bound device signing/recipient envelopes and DPAPI/ACL protection preserved                                                    |
| Automatic locking   | Existing renderer deadline plus independent native inactivity expiry; page reload/crash/exit/manual locking drops key references; ordinary hash navigation does not lock unexpectedly                         |
| Clipboard           | Native write and conditional timed clearing, independent of renderer timers; no general clipboard-read IPC; unrelated contents are preserved and errors do not prevent vault locking                          |
| Drive preparation   | Direct v3 adapter, system-browser native PKCE/state/loopback flow, native token storage and refresh, explicit folder grants and signed Household invitations                                                  |
| Permissions         | Default `drive.file`; incremental scope union disabled; unexpected broader OAuth/refresh scopes rejected; no automatic broadening fallback                                                                    |
| Sync                | Automatic attempt after edits, startup and periodic retry; Sync Now, error state, last Drive round trip and pending encrypted changes; normal local saves remain available during stalled cloud requests      |
| Concurrent edits    | Upload a stable journal snapshot, merge late local commits, retain pending writes, detect forks and missing previously observed history; do not discard edits made during network waits                       |
| Conflict handling   | Explicit whole-version selection with expected-head checking and a signed multi-parent commit; current master/recovery wrappers retained for Personal resolution; all branches remain encrypted in history    |
| Retained history    | Locally decrypt a version before selection; restore missing entries only after resolving active conflicts, preserving existing live IDs                                                                       |
| Portable backup     | Versioned XChaCha20-Poly1305 encrypted file containing wrapped identity, vaults, membership and retained journals; all Google tokens excluded                                                                 |
| Restoration         | Empty matching-role destination only; authenticated backup checks, protected new local store, fresh Google consent required; original source is not overwritten                                               |
| Recovery            | Backup can be unlocked with its historical master password or recovered using its historical recovery key; the recovery path rewraps master, rotates recovery and requires full replacement-code verification |

Disconnect removes this installation's saved OAuth tokens and stops its sync. It deliberately does not revoke a project-wide Google grant for other installations. It is not device revocation. Account metadata retained after disconnect/restore does not establish a new Google connection.

`.lockbox-backup` files and native sealed stores are excluded from Git and formatting. The export dialog rejects known website roots, `.git` internals and application installation directories. Files are created exclusively rather than overwriting existing backups. User-selected removable storage can have different filesystem protections; the portable file's authenticated encryption is essential.

## Backup format and restoration requirements

`portable-backup.mjs` uses libsodium's existing XChaCha20-Poly1305 primitive, random 24-byte nonce, a 32-byte random vault root and an account-bound/versioned authenticated context. The unencrypted header carries only format/role/account ID and the existing encrypted key profile/KDF parameters. The payload additionally encrypts identity/member metadata, existing encrypted vault envelopes, wrapped private identity and journals. No plaintext credentials or Google tokens are export fields.

The renderer derives or recovers the root locally; it never sends a master password to native IPC, Google or a backend. Temporary root bytes pass only through the restricted local native channel and are cleared after use. Restoration verifies the authenticated header/payload identity, profile, key envelope, membership signatures, journal signatures and parent availability before saving. A failed validation or write restores in-memory state and leaves the destination locked. Actual OS/filesystem failure modes still require independent review.

Restoration requires an empty profile with no vaults, membership or retained journal. It never restores the legacy server database. Recovery from an unresolved Personal fork is blocked when replacing the password/profile so that recovery cannot silently merge conflicting heads. Restore such a backup using its original master password, resolve the conflict and then perform recovery changes.

Portable recovery currently preserves the original signing/device identity. A second recovered copy can therefore still operate alongside the source; an explicit negative test documents this limitation. This is not final multi-device enrollment and cannot revoke a lost or malicious device. Old backups also retain their historical encryption/recovery state. New backups and reviewed key rotation/revocation are required before real household use.

## Google dependency and real-test status

**No real Google OAuth consent, upload, download, two-account sharing or physical two-computer test was completed.** `proof/windows/native-config.json` is absent. The tracked configuration example is a placeholder. The UI stays truthful and disables connection when registration is absent.

Developer-owned prerequisites remain:

1. A Google project with Drive API v3 and the native Google Picker integration enabled.
2. A registered Desktop public OAuth client for this application, provided to the developer build through ignored `native-config.json`. No distributed client secret or service-account credential.
3. Configured consent audience/branding and two disposable test Google accounts. Each person must approve their own Google account in the system browser.
4. Real verification that `drive.file` permits every required operation and discovery of **new child files created by the other account**, without silently requesting broader access. A folder ID/Drive share is not automatically app authorisation. Verify file ownership, inherited permissions, reconnect and token refresh too.
5. Production publishing/verification as Google requires. External Testing-mode Drive refresh tokens can expire after seven days; weekly reauthorisation must not be presented as reliable permanent sync.

The developer—not the owner—must handle registration, build configuration and API configuration. None was created or activated here. The earlier optional full-Drive proof setting remains explicit/developer-gated for compatibility; it was not enabled, and using it as a workaround requires a separate permissions decision. Mobile clients will require their own supported platform registrations/authorisation; the Desktop loopback implementation must not simply be copied to phones.

## Validation

The existing regression suite completed cleanly: **149/149**, including its isolated Chrome/Edge, Caddy, authentication, vault, backup, recovery and deployment rehearsals. These validate preserved legacy behaviour; their simulated Google tests do not validate the new native live Drive integration.

Windows validation passed **37/37**: 23 native/core/OAuth checks, four simulated-DOM interface checks and ten packaged Windows-process checks. Together with the 149 legacy checks, **186 checks passed**. Windows validation consists of:

- Native/core/OAuth tests, including offline CRUD, atomic moves, wrong/tampered keys/ciphertext, master-bound identities, recovery, portable backups, identity-preserving upgrade, empty-only restoration, stale/conflicting selection, retained branch recovery, scope rejection, lost-upload retry and local writes during a stalled Drive request.
- Simulated-DOM interface tests for master/recovery setup, blank forms, create/reveal/native-copy/edit/delete, offline Household/folders, generation, backup export, locking and reload. Native calls are in-memory test doubles; HTTP is forbidden in that UI test.
- Actual packaged Electron processes using fresh DPAPI/ACL-protected test profiles, a test-only simulated Google transport and Fastify genuinely stopped. Checks include independent profiles, duplicate-profile process exclusion, Household/Personal separation, portable file restoration, peer shutdown/restart, concurrent branches/resolution and bundled renderer startup. Exact latest flags are in `native-proof-results.json`.

Installer copying/integrity is tested with disposable filesystem fixtures; the Start menu wizard/shortcut and SmartScreen experience have not been manually exercised. Clipboard logic/transport tests use fictional in-memory clipboard data, not the owner's real clipboard. Physical machines and real Google accounts remain untested. Passing tests does not establish production security.

Production builds, frontend/backend/Windows TypeScript, ESLint and Prettier completed successfully. No dependency was installed or upgraded: the Windows runtime retains Electron **45.2.3** and libsodium-wrappers-sumo **0.8.4**. Package/lock metadata changed to `lockbox-windows` **0.2.0** only.

## Release blockers

- Real Google registration and the complete two-account/two-physical-computer acceptance test.
- Reviewed per-device enrollment, revocation and signing/encryption-key rotation, including compromise recovery and freshness after total local-state loss. Google folder permissions are not sufficient.
- A final local account/login-password layer, separate from master unlocking. The preview has per-installation cryptographic identities, not completed decentralized username accounts; legacy login remains untouched.
- Independent review of the key hierarchy, backup format and recovery, signed membership/invitations, replay/rollback, hostile inputs, clipboard/memory handling and dependency/distribution integrity.
- Usable final invitations with expiration/replay policy; current pairing still uses explicit public request/grant and independently compared full fingerprints.
- Production journal compaction: the preview retains at most 256 commits per namespace and fails closed at its bound. Backup/store size bounds also apply. No per-field merge UI is claimed.
- Signed/trusted Windows distribution and an update strategy; package hashes are not publisher authentication. The installer is a preview folder installer, not a signed MSI or a verified production updater.
- Automatic portable-identity backup to off-device storage is not implemented. Manual encrypted export/restore works; Drive journal snapshots alone are not a complete lost-identity recovery system.

## Changed files in this implementation turn

- Existing Windows native: `main.mjs`, `oauth.mjs`, `preload.cjs`, `replica.mjs`.
- New Windows native: `install.mjs`, `portable-backup.mjs`, `secret-clipboard.mjs`.
- Existing Windows renderer: `main.tsx`, `index.html`.
- New renderer modules: `entry.tsx`, `native-api.ts`, `backup-restore.tsx`, `conflict-review.tsx`, `desktop-security.tsx`.
- Windows packaging/metadata: `scripts/package.mjs`, `package.json`, `package-lock.json`.
- Windows tests: expanded `core.mjs`, `oauth.mjs`, `native.mjs`; added `desktop.mjs`, `renderer.mjs`.
- Shared reuse: `src/lib/secure-clipboard.ts`, `src/features/credentials/credential-dialogs.tsx`.
- Documentation/protection: `WINDOWS.md`, this report, Windows README, historical-proof pointer, `.gitignore`, `.prettierignore`, generated native test evidence. Existing regression scripts may refresh their own evidence JSON reports.

No new database migration, authentication server, hosting service, mobile application, extension implementation or public deployment was introduced.

Primary Google references checked: [Desktop OAuth, PKCE and optional client secret](https://developers.google.com/identity/protocols/oauth2/native-app), [native Picker and per-platform registration](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker).
