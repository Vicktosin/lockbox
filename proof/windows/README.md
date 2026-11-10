# Windows local-first feasibility proof

Fictional data only. This is an isolated experiment, not a migration or a release for real passwords. Existing React, Fastify, SQLite files and account records are not read by the desktop application.

The Windows package reuses the React dashboard, credential components, password generator and Phase 3 Argon2id/XChaCha20-Poly1305 vault engine. Electron 45.2.3 supplies an installed application runtime and Windows DPAPI protection. libsodium-wrappers-sumo 0.8.4 supplies Ed25519 signatures and X25519 sealed boxes for explicit Household invitations. Root dependencies and configuration are unchanged. Rust/Tauri tooling was unavailable; this proves the device architecture using Electron, not the final Tauri runtime or mobile runtime.

## Developer prerequisites before real Google testing

The developer must register a Desktop public OAuth client, enable Drive API v3 and Google Picker, configure the consent audience and provide two disposable Google test accounts. The owner must not configure Cloud Console, credentials, environment variables or terminals. No registration or account consents were available during this proof. Mocked consent is never reported as a real connection.

Copy the example to ignored `native-config.json`, supply the registered public client ID and rebuild/package. Do not supply a web client secret or service-account credential. The placeholder is not a usable Google registration. If the configuration is absent, the UI explicitly disables Google connection.

The supported system-browser native flow uses PKCE S256, random state, an ephemeral IPv4 loopback callback, offline consent and refresh tokens. Tokens stay in the native process and the OS-protected local file. The temporary callback is not a central application server and ends after consent. The renderer cannot make HTTP requests or call Fastify.

Default permission: `https://www.googleapis.com/auth/drive.file`. The partner selects the granted proof folders through Google's native Picker. The developer must verify access to newly added children across users with this scope in the live experiment. Do not assume folder membership or a folder ID confers app authorization. A separately configured restricted `drive` scope is accepted only with explicit developer opt-in and new user consent; it is not selected automatically and is not validated by this proof.

## Building and diagnostics (developer only)

From the repository root:

```powershell
npm.cmd --prefix proof/windows ci --ignore-scripts
node proof/windows/node_modules/electron/install.js
npm.cmd --prefix proof/windows run typecheck
npm.cmd --prefix proof/windows run build
npm.cmd --prefix proof/windows run package
npm.cmd --prefix proof/windows test
```

Packaging writes a new portable `releases/LockboxProof-Windows-<timestamp>` folder with `LockboxProof.exe`, owner/partner launch shortcuts and a SHA-256 inventory. Copy the entire folder when testing on a second Windows computer. It is unsigned and has no installer or update service. It contains no existing database, key file, credentials or OAuth tokens.

Normal profiles are isolated under `%APPDATA%/LockboxFeasibilityProof-v1/owner` or `partner`; Windows filesystem ACLs and DPAPI protect the outer file, with Phase 3 authenticated encryption protecting the vault contents within it. These are separate proof profiles even when launched on the same Windows account. No browser localStorage/IndexedDB keys or account sessions are used. Unavailable OS protection fails closed.

Automated packaged tests start two real Electron processes with new protected temporary profiles. An ephemeral Windows named pipe connects them to a **test-only simulated Google transport**, not a production service. The application itself has no permanent listener. Tests use fictional Google identities and fixture credentials exclusively. They stop one executable, restart the other and retain concurrent branches. This is not a substitute for testing two physical machines and real Google accounts. Test mode requires explicit diagnostic flags, a newly named temporary root and a random pipe; it never opens normal profiles. Do not enable it in a release.

`LOCKBOX_PROOF_REQUIRE_BACKEND_STOPPED=1` makes packaged tests refuse to run if a service answers the existing development backend port. The maintainer restores that service after the bounded rehearsal. See `docs/native-proof-results.json` for the latest recorded evidence.

## Manual live acceptance once the developer dependency is supplied

1. Developer prepares two packages with the same registered public client ID and two disposable Google accounts. Keep the existing app and database untouched.
2. On each Windows machine, open the appropriate shortcut, create a fictional vault and confirm its recovery key. Independently approve Google access using that machine's own test Google account.
3. Owner creates new `LOCKBOX-PROOF-*` folders and an encrypted test Household Vault. No existing central folder is reused or changed.
4. Partner supplies the public pairing request. Compare full identity fingerprints through an independent trusted channel. Owner explicitly grants only Household and partner Personal folder access. Partner verifies the owner's fingerprint and accepts the signed, recipient-encrypted invitation.
5. Partner authorizes the specific proof folders through Google, synchronizes and imports the Household key into their own master-protected keyring. Never exchange Google passwords, Personal keys or recovery keys.
6. Save fictional Personal and Household credentials; verify each Personal Vault is decryptable only by its owner. The Drive folder owner can see partner ciphertext and metadata, but must fail to decrypt partner Personal contents.
7. Disconnect networking, edit, restart, reconnect and compare results. Stop the other computer entirely and repeat. Stop Fastify for the entire live workflow. Retain test evidence without credentials or tokens.
8. Edit the same Household state simultaneously. Both branches must survive and the UI must warn and refuse further destructive writes. Do not silently pick a winner.

## Explicit limits

One fictional identity and one device key per installation; no final account login layer, device enrollment/revocation, user removal, invitation expiry, key-rotation protocol or migration. No conflict-resolution UI. History is bounded at 256 immutable files per namespace and fails closed at the bound; no production compaction. Automatic sync is attempted after edits with Sync Now for retry; no mobile background execution guarantee. DPAPI protects against offline file theft, not malware running as the signed-in Windows user. Identity fingerprints and encrypted grant exchange are deliberately manual for this proof.

The Drive owner can delete ciphertext or revoke folder access. Signatures, authenticated encryption and retained local history detect tampering/missing known history; they do not prove freshness after total local-state loss or prevent malicious members replaying old material. Approved recipients cannot be made to forget copied data. Google's identity/folder ACLs do not replace cryptographic Household membership. These areas require independent review before migration.
