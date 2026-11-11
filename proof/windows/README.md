# Lockbox for Windows - local-first preview

> Current Google integration status: [live qualification and security gates](../../docs/google-drive-live-qualification.md). Preview 0.2.1 keeps ordinary-vault cloud uploads blocked; real Google testing uses separate fictional profiles. Earlier evidence below is historical.

The Windows application is the primary product direction. This existing folder retains its historical name to preserve the working proof and encrypted profiles; it is not a second application. See [owner installation instructions](../../WINDOWS.md) and [current implementation/security status](../../docs/windows-local-first-status.md).

**Fictional data only. Not a production release. Real Google authorisation, physical two-computer validation, revocation/key rotation and independent review remain outstanding.**

## Owner experience

Extract the supplied package, double-click **LockboxSetup.exe**, choose owner or partner, then open **Lockbox Preview** from the Start menu. Alternatively, open **Lockbox.exe** directly. No terminal, server, Vercel access or environment configuration is needed to create and use an offline encrypted local vault. Setup verifies recovery information before persistence. Do not bypass Windows security warnings; this is an unsigned preview.

Normal encrypted profiles remain under AppData/LockboxFeasibilityProof-v1/owner or partner. DPAPI and restrictive ACLs protect the store/tokens, with master-protected root/Personal/Household/device-key envelopes inside. Existing master-bound identity improvements are retained. No legacy database/account migration occurs. Installation copies into a new version directory and creates a role-specific shortcut; it does not delete or overwrite previous versions or vaults.

Credential forms, folders, search/categories, generator, reveal/copy, idle lock, master/recovery controls, portable encrypted backup/restore and explicit whole-version conflict handling reuse the original React components and vault engine. Normal local edits remain available while cloud requests are pending. Unuploaded changes are shown separately from the last successful Drive round trip. Native clipboard clearing is conditional and cannot erase OS history.

## Google registration - developer dependency

No registered Desktop OAuth client is supplied to this build. The developer must enable Drive API v3 and Google Picker in their project, register a Desktop public client, configure consent/test users and place the **public client ID** in ignored native-config.json using the tracked example. Rebuild/package afterward. Never include a client secret, service account or refresh token in configuration or frontend environment variables. The owner does not do this work.

Each installation uses its own Google account through the system browser, PKCE S256, random state and a short-lived loopback callback. There is no central token broker or Lockbox backend. Google tokens remain in the native OS-protected store. Default permission is drive.file; unexpected broader scopes are rejected. The old explicit full-Drive proof opt-in is not enabled automatically or approved as a workaround.

Connect remains disabled when developer registration is absent. A real connection is recorded only after successful Google authorisation/account verification. The test transport never constitutes live integration evidence. Restoring a portable backup requires fresh Google authorisation; backup files exclude tokens. Disconnect stops only this installation, not other devices' grants.

## Developer commands

Run from the repository root:

```powershell
npm.cmd --prefix proof/windows run typecheck
npm.cmd --prefix proof/windows run build
npm.cmd --prefix proof/windows run package
npm.cmd --prefix proof/windows run test:core
npm.cmd --prefix proof/windows run test:renderer
npm.cmd --prefix proof/windows run test:packaged
```

Dependencies are already isolated in this directory: Electron 45.2.3 and libsodium-wrappers-sumo 0.8.4. The package is named lockbox-windows 0.2.1. No dependencies were added/upgraded by this continuation. Root package/build/configuration still describe the preserved legacy web application. The native build writes only releases/native-proof-build; packaging creates a new releases/Lockbox-Windows-Preview-* directory with Lockbox.exe, LockboxSetup.exe, resources and SHA256SUMS.json. Keep all files together. Hashes detect corruption but do not prove publisher authenticity.

The stopped-backend-rehearsal.ps1 maintainer script recognises the existing development backend, stops it for packaged tests and restores it in finally. LOCKBOX_PROOF_REQUIRE_BACKEND_STOPPED=1 makes the tests refuse to run if that backend answers. This is not an owner setup step.

## Live acceptance procedure - still not completed

1. Developer supplies the registered client and two disposable Google test accounts, and builds the package. Obtain two physical Windows machines; keep existing data untouched.
2. Install owner/partner roles independently, create fictional vaults, verify recovery and export private portable backups. Stop Fastify throughout the experiment.
3. Independently approve Google using each person's own account. Owner creates new LOCKBOX-PROOF folders; existing central folders are not reused or made public.
4. Partner creates a public pairing request. Compare complete public identity fingerprints through a trusted independent channel. Owner explicitly grants only Household and partner Personal folders and provides the signed, recipient-encrypted invitation. No Personal key or Google password is exchanged.
5. Partner verifies the owner's fingerprint, accepts the grant, authorises the specific folders through Google, synchronises and imports the Household key into their own master-protected keyring.
6. Verify private vault decryption boundaries. In particular, test discovery/access to new files added by the other Google account with drive.file, not just already-selected folders. Verify ownership, inherited permissions, token refresh, disconnect/reconnect and errors.
7. Edit offline, restart, reconnect and compare; edit during a pending request; stop the other computer and repeat. Confirm changes persist locally and eventually upload without losing history.
8. Make simultaneous Household changes. Decrypt/review both branches, explicitly choose a whole version, synchronise and restore missing entries from retained history. Do not silently choose a winner.
9. Restore portable files into fresh, empty installations using master and recovery paths. Preserve the source. Recovery cloning is not device revocation: document that release blocker rather than claiming it passed.

## Security limits

One native identity per installation; separate decentralized username/login accounts, per-device enrollment/revocation and Household key rotation are unfinished. Recovery preserves the old device identity and cannot stop an already-authorised source. Current invitations require manual public request/grant exchange and fingerprint comparison, with no final expiry policy. Signed journals retain at most 256 files per namespace and need production compaction. Conflict resolution chooses a whole version; missing-entry recovery is available, automatic per-field merging is not.

Portable backups use established XChaCha20-Poly1305 and the master/recovery-protected root, but their format/protocol needs independent review. Losing all identity/profile data without an exported portable backup has not been proven recoverable from Drive journals alone. Backups exclude Google tokens and must stay private and off-device. Git/formatting ignores and export-location checks help prevent accidental website/source publication.

Drive owners/members can disrupt availability; signatures and retained local history do not guarantee freshness after total state loss. Recipients cannot be made to forget copied data. JavaScript cannot guarantee erasure of all strings/copies, DPAPI cannot defend against malware running as the signed-in OS user, and clipboard history may retain copies. Do not enter real credentials until the live Google, recovery/revocation and security gates are satisfied.
