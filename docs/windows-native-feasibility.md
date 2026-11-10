# Local-first Windows feasibility: evidence and release gate

This is a limited fictional-data proof, not the full migration. The existing web application, backend, database, key files and accounts are preserved. No original account has been migrated; no existing Drive folder has been used. The deployment architecture in earlier reports describes the legacy application, not this isolated experiment.

## Built

`proof/windows` contains an independent Windows desktop package using the existing React interface and Phase 3 vault engine. Its native process calls Google Drive directly; there is no Fastify API, SQLite database, hosted server or web hosting in the desktop application's runtime path. Pure legacy filesystem ACL helpers are reused without importing database initialization or server startup.

Electron 45.2.3 and libsodium-wrappers-sumo 0.8.4 are installed only in the proof directory with an independent lockfile. Electron was chosen for this bounded experiment because Rust/Tauri build tools were unavailable. It does not validate Tauri, Rust, SQLCipher, Android or iOS. An executable package and checksums are generated under `releases/LockboxProof-Windows-<timestamp>`; the normal React production build remains separate.

### Vault and sharing controls

- The existing client Argon2id and XChaCha20-Poly1305 formats, recovery confirmation and independent random Personal/Household keys are reused. Master passwords stay in the renderer and are not sent to Google or native IPC.
- Windows DPAPI and existing restrictive filesystem ACLs protect the isolated native file and OAuth refresh tokens. No master-derived or decrypted vault key is persisted in localStorage or IndexedDB. Unavailable OS protection fails closed.
- Native OAuth is system-browser authorization-code flow with PKCE S256, random state and a short-lived loopback callback. No confidential OAuth client secret is accepted. Tokens are not returned to the renderer or logged.
- Each installation has its own fictional identity, Ed25519 signing key and X25519 public encryption key. Explicit signed Household grants contain only a recipient-sealed Household invitation, never a Personal key. Full public fingerprints must be compared independently. A recoverable encrypted grant is retained if the initial synchronization fails.
- The owner creates new proof-only folders. The partner gets writer access to the partner Personal and Household folders, never the owner Personal folder or the owner's Google credentials. The Drive owner can see partner ciphertext, but cannot decrypt the partner Personal Vault.
- Changes are signed immutable snapshots with explicit parent hashes. Preallocated Drive IDs make retry after an uncertain upload response idempotent. Missing known history, invalid signatures, namespace substitution and multiple heads produce visible failures rather than silent overwrites. Both conflict branches remain retained; this proof does not implement the final resolution interface.

## Validation and boundaries

The exact latest packaged-test evidence is in [native-proof-results.json](native-proof-results.json). `completeLiveProofPassed` deliberately remains false. The following layers must not be confused:

| Layer                                              | Evidence                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reused client cryptography                         | Correct/wrong master, separate Personal keys, encryption/decryption, tampering rejection, master changes and recovery confirmation exercised with fictional values.                                                                                                |
| Native OAuth implementation                        | Real ephemeral callback receiver exercised against simulated Google token responses; state, PKCE, narrow scope and single-flight refresh tested. No live Google consent occurred.                                                                                  |
| Drive adapter                                      | Actual HTTP adapter exercised against a simulated Drive transport for permission checks, upload/readback, retry, offline restart, sharing and concurrent branches.                                                                                                 |
| Windows native runtime                             | Two real packaged Electron processes, separate protected files and actual Windows OS encryption tested. One process was stopped while the other continued. This is one Windows machine, not two physical computers.                                                |
| No Fastify                                         | A bounded maintainer rehearsal stops the existing development listener and runs the packaged diagnostic workflow; the evidence records whether that check passed. The legacy listener is restored afterward. No backend data initialization or reset is performed. |
| Real Google, two Google accounts and two computers | **Not run.** No registered native client or independent account consents are available. No result above proves real cross-user Picker/Drive authorization semantics.                                                                                               |

The packaged diagnostic harness uses a temporary Windows named pipe to route fictional Google requests to the test fixture. It is test machinery, not a required application service. Normal operation calls Google's HTTPS APIs from the native process and has no permanent application listener. The normal renderer is sandboxed, cannot navigate to remote pages or make HTTP requests, and uses a narrow origin-checked IPC bridge. This establishes a testable dependency boundary; the entire real-Google workflow still needs live verification.

## Check results

- New proof: 11 core/OAuth tests and five packaged Windows checks passed. The packaged checks include a sandboxed React startup handshake, actual DPAPI, two independent processes, peer shutdown/restart, Household delivery and conflict preservation. Google responses remain simulated throughout these automated checks.
- Existing application: 105 regression checks passed in the initial complete run. Six test files failed to initialize because existing Windows ACL helper processes timed out around an execution interruption. All 44 checks in those six files passed on an unchanged rerun, giving 149 passing existing checks across the runs. The initial run is not represented as a clean pass; no permissions or test assertions were weakened.
- Existing production build, existing frontend/backend TypeScript checks, proof renderer TypeScript check, ESLint and Prettier passed. The full formatting check required permission to traverse past the excluded protected data directory; no private data was formatted.
- Root package manifests, Vite configuration, frontend source, backend implementation, migrations and existing data were not replaced. New code and its separate dependency lockfile are under `proof/windows`; public evidence is under `docs`, and generated packages are under `releases`.

The new package is unsigned, for fictional data only. Automated diagnostics are not manual UI acceptance, two-machine acceptance, a security audit or successful live Google authorization.

## Missing external developer dependency

The maintainer must register a Google **Desktop public OAuth client**, enable Drive API v3 and Google Picker, configure the consent audience, and obtain approval from two disposable Google accounts on two test machines. Only the public client ID is bundled; no web-server credentials or service account is reused. This work belongs to the developer, not the owner. No owner console, environment-variable or terminal setup is requested.

The default scope is `https://www.googleapis.com/auth/drive.file`. Google's native Picker grants the partner access to the explicitly selected shared proof folders. Folder ACL membership and per-application authorization are separate requirements. In particular, access to future children created by the other user must be tested with Google, not inferred from the fixture. If that scope fails the real scenario, halt and evaluate an explicitly consented alternative; never silently request broader access. The implementation's optional restricted full-Drive configuration is unverified and is not the recommended default.

References: [Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app) and [native Google Picker](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker). Developer registration and distribution policy are external dependencies even though no application hosting is required.

## Security limitations requiring review

This experimental membership/signature composition is not an independently reviewed production protocol. It uses established primitives, but their combination still needs protocol review, hostile-input testing and supply-chain assessment. No production-security claim follows from passing tests.

Personal isolation is cryptographic; the Drive owner retains availability control over all folders and can delete ciphertext or revoke access. Folder names, public identities, snapshot sizes and timing remain visible. OS protection cannot defend against malicious code running as the signed-in Windows user. JavaScript cannot guarantee zeroization of all string copies. Clipboard clearing remains best effort and does not erase clipboard history or third-party clipboard managers.

The proof has one fictional device identity per installation and no final login-password layer, device enrollment, device revocation, Household member removal/key rotation, invitation expiration or multi-device identity restoration. Device signing/recipient private keys are DPAPI protected, rather than wrapped by the master-derived vault root. Consequently a pending Household invitation relies on the Windows account boundary before it is imported into the master-protected keyring; the native unwrapping operation is not cryptographically gated by master-password possession. That boundary must be reviewed and strengthened before real use. Personal keys are not carried in these invitations.

Master-password recovery is tested against retained encrypted profiles; loss of the entire native profile/signing identity has **not** been proven recoverable from cloud storage. Existing account recovery remains untouched in the legacy app. The proof must not replace it until a reviewed migration and portable encrypted backup/recovery flow exist.

Known-history checks detect missing previously observed snapshots. They cannot guarantee freshness after total local-state loss, prevent a malicious authorised member replaying content, or make a former recipient forget data. Conflict handling stops writes and preserves branches; usable reconciliation and bounded history compaction remain migration gates. No Android background-sync or iOS execution guarantees have been tested.

## Next gate, not another migration phase

Complete the developer registration, then run the manual live procedure in [the proof README](../proof/windows/README.md) on two physical Windows machines with fictional entries only. Keep Fastify stopped throughout and verify owner-offline operation, both Personal Vault boundaries, independent Google consents, Household grants, offline restart, new child-file visibility and simultaneous updates. Record actual scope/permissions and failures without tokens or keys.

Only after that proof passes and the owner reviews its results should the full migration start. Before Android/iPhone/Chromium implementation: settle the final desktop runtime, review membership/recovery/revocation, establish encrypted portable identity backups and a shared versioned format, then validate platform secure storage and supported platform-specific Google clients. Mobile builds require their own native toolchains and signing/distribution arrangements. An extension must use an authenticated, explicitly paired native bridge and user-approved exact-origin autofill; neither backend cookies nor existing browser bridge code can simply become a decentralised trust mechanism.

No owner action is needed now. Do not enter real credentials into this unsigned proof package.
