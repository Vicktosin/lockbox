# Google Drive integration qualification — 11 November 2026

## Release decision

Windows preview 0.2.1 is an offline fictional-data preview with an isolated real-Google qualification mode. **Real Google authorisation and two-computer synchronisation have not been demonstrated. The integration is not complete and is not approved for real credentials.** No hosted Lockbox backend is used by the native adapter. Vercel and the legacy database are unchanged.

## Implemented application work

- Native system-browser OAuth: public Desktop client, PKCE S256, state, temporary loopback callback, cancellation, verified Google account and narrow `drive.file` scope. Requested Picker folders must actually be returned as selected before exchanging the code.
- Native OS-protected token persistence and refresh. Failed durable refresh saves roll back memory; stale refresh/consent responses cannot restore a disconnected connection. Concurrent consent is rejected.
- Drive v3 encrypted signed journal upload/download, folder validation and explicit sharing. Network-boundary validation rejects unexpected fields, malformed envelopes and altered signatures before upload. No refresh token or client secret enters the renderer.
- Existing encrypted local queue, automatic retries, offline edits, explicit conflict review and retained branches remain. Permission creation is idempotent; invitations and initial Household membership commits persist together.
- A separate Google-test mode, Start menu shortcuts, isolated protected profile directory and safe qualification-report export. Ordinary profiles, backups and invitations cannot cross into test mode. Reports exclude tokens, key material and Google email addresses and always leave physical-computer verification and integration completion false.
- Normal vault uploads remain blocked, even if a developer client is installed. Existing local vaults and recovery records are preserved. Test mode uses fictional records only; its naming checks are guardrails, not a proof that user-entered text is non-sensitive.

No dependencies were added or upgraded. Existing Electron 45.2.3 and libsodium-wrappers-sumo 0.8.4 remain.

## Missing developer-owned Google setup

The ignored `proof/windows/native-config.json` is absent. Its tracked example is not a real registration. A developer must:

1. Own a Google Cloud project, enable Google Drive API v3 and Google Picker API, and configure the OAuth consent screen/audience and both test Google accounts.
2. Register an installed **Desktop application** public OAuth client. Use the native system browser and dynamically allocated loopback callback; no hosted redirect server is needed. Do not package a client secret, service account, API credential or refresh token.
3. Supply only the registered public client ID through the existing native configuration and rebuild the package. Picker uses Google's supported native OAuth Picker flow, not a frontend secret or a folder-link shortcut. Verify any project/platform configuration against the actual registered client.
4. Request only `https://www.googleapis.com/auth/drive.file`. Test each account's explicit Picker access to both Household and partner-Personal exchange folders. Folder sharing and API authorisation are distinct. **Do not assume selecting a folder grants API access to every existing or future child file.** If the narrow scope cannot support discovery across accounts, record failure and redesign explicit file selection before requesting approval for any broader permission.
5. Check consent publishing/verification and testing-mode refresh-token lifetime before distribution. Developer registration and consent are external dependencies; a successful mock does not satisfy them.

This turn's browser safety check stopped automation because it could not verify the active Chrome URL. No Google project, OAuth client, API activation, consent or live upload was performed. The owner is not being asked to configure Google Cloud. A maintainer needs approved browser access to complete those steps; the owner may need to sign in personally or approve Google's consent screen.

Official references: [installed application OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [native Picker](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Remaining security blockers

Master-protected device identity is retained, but independent per-device enrollment, revocation, lost-device exclusion and Household encryption/signing-key rotation are unfinished. Portable recovery restores a copy of the existing device identity; it does not revoke the lost installation. Invitation expiry and the complete membership/recovery protocol need review. A separate local login-password layer is not implemented by this preview. These are not solved by Google OAuth, Drive permissions or master-password changes. Ordinary live synchronisation remains gated for this reason.

An owner who controls the Drive folder can see another member's encrypted files/metadata; Personal plaintext and keys must remain unavailable. Drive grants are not a replacement for signed Household membership. Revocation cannot erase plaintext or old keys already copied by an authorised member. OS compromise, unlocked process memory, clipboard history, unsigned distribution and unbounded retained history remain risks. Independent security review is required.

## Two-person acceptance procedure — pending actual Google registration

Use two physical Windows computers and two different Google accounts. Use fictional credentials only. Keep recovery information private; do not send it with reports.

1. Install the supplied preview without changing existing profiles. Open **Lockbox Google Drive test - owner** on one computer and **Lockbox Google Drive test - partner** on the other. The test profiles live under `LockboxGoogleDriveTest-v1`, separate from existing local profiles. Create separate master passwords and verify each recovery key.
2. Each person selects **Connect my Google account**, signs into their own Google account and approves the narrow Google request. Check that the displayed account is correct. Do not proceed if broader Drive access is requested.
3. The owner creates new private test folders and a local Household. Exchange the public pairing information and compare fingerprints using a separate trusted conversation. The owner explicitly grants the partner access; the partner accepts the signed encrypted invitation and checks its fingerprint. Reauthorise requested folders using Picker where prompted. Never share Personal keys or Google credentials.
4. Create Personal test records separately and a Household record. Sync both installations. Verify both see the Household record, neither can decrypt the other's Personal records, and new Household records created **after** initial authorisation are discovered in both directions. Record permission/discovery failures without broadening scopes.
5. Shut down the owner's computer completely. On the partner computer, restart Lockbox, retrieve the previously uploaded Household record and make another encrypted change. Reverse roles and repeat. This is required physical evidence; simulated instances are insufficient.
6. Disconnect each computer from the network, edit fictional records, close/reopen the app, reconnect and sync. Edit the same Household entry on both computers while offline, then reconnect. Verify an explicit conflict, retained branches, deliberate resolution and convergence without silently losing updates.
7. Disconnect/reconnect Google and verify no stale request resurrects a disconnected grant. Export an encrypted portable test backup and restore to an empty matching-role test profile; verify its contents and recovery path. Do not restore over an existing vault. Restoration currently clones identity and is not lost-device revocation.
8. Export each safe qualification report from Settings. A maintainer must compare both reports and observed Google files, permissions and physical test evidence. The report itself deliberately cannot certify two physical computers or mark integration complete.

## Validation records

The automated Google suite uses fictional accounts, mocked Google responses and local loopback callbacks. It covers consent/refresh races, cancellation, Picker selection, scope gates, failed persistence, encrypted packet validation, error classification and test-profile isolation. Other native/renderer suites cover local encryption, invitations, conflicts, backup/restore and backend-free operation. Packaged diagnostics are simulated Google tests, not real authorisation. See `native-proof-results.json` for packaged evidence and the completion report for this run's totals.

Source checkpoint: `releases/checkpoints/before-google-integration-1794396429693`. This preserves source, not a backup of user vaults. No existing database or vault migration was performed.
