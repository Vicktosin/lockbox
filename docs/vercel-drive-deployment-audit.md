# Vercel deployment and Google Drive audit

Observed 11 November 2026, approximately 08:51 UTC. This is an audit, not a deployment, migration, penetration test or production-security certification.

## Decision in ordinary language

The public site at <https://lockbox-ochre.vercel.app> publishes the original web application's frontend. It does not provide a working Lockbox account or vault service. It is not the Windows local-first application. Do not enter real credentials or treat this site as a released password manager.

Keep Vercel optional: public installation information and verified application downloads are appropriate. Account identity, encryption, encrypted persistence and Drive synchronisation must run on each device rather than depend on a Vercel or other central Lockbox backend. Nothing was rebuilt or deployed during this audit.

## Evidence and access limits

- GitHub identifies `Vicktosin/lockbox` as a public repository, default branch `main`, homepage matching the site above. Its Vercel status reports successful deployment for commit `ba81c794676fe81734096c7f68ad9bb1e6316f0c`.
- The live JavaScript, CSS and manifest match the existing local root `dist` files byte for byte. This proves the application family being served; the production alias's precise deployment/commit mapping was not independently read from the private Vercel dashboard.
- Root `package.json` builds `src/main.tsx` through Vite into `dist`. `server/index.ts` starts Fastify separately. `proof/windows` has its own Electron/native build under `releases`, not the root web output. Electron IPC, DPAPI and its temporary OAuth callback cannot be supplied by deploying the renderer as an ordinary static website.
- No repository `vercel.json`, root `api` directory or local `.vercel` project metadata is present. No Vercel API credential is available in this session. The attempted read-only browser inspection ended with `Computer Use app approval timed out`.
- Consequently, private dashboard build overrides, environment-variable names/values, logs, access settings and Google Cloud configuration were **not** verified. The effective published output and route responses below were verified directly. Values of private environment files, account records and OAuth grants were not inspected.
- The ten pre-existing modified files, including recent native identity-key hardening, remain uncommitted locally. Those Windows proof changes are absent from the checked GitHub commit. This audit has not committed or pushed them, because pushing a connected branch may trigger publication.

## Live checks

| Read-only request                | Result                       | Meaning                                                                      |
| -------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `GET /`                          | 200 HTML, title LOCKBOX      | Web document is served over HTTPS                                            |
| `GET /assets/index-Drv5YSgi.js`  | 200 JavaScript, 430361 bytes | Original frontend; matches local build                                       |
| `GET /assets/index-BQFYS1SG.css` | 200 CSS, 58511 bytes         | Frontend styling is served                                                   |
| `GET /manifest.webmanifest`      | 200 manifest                 | Manifest exists; does not prove installability or offline operation          |
| `GET /api/auth/me`               | 404 Vercel text response     | Account-session service is unavailable at this origin                        |
| `GET /api/drive/status`          | 404 Vercel text response     | Drive connection/synchronisation service is unavailable                      |
| `GET /healthz`, `/api/healthz`   | Both 404                     | No operational backend health route is exposed                               |
| `HEAD /settings`                 | 404                          | No clean-path fallback observed; existing application navigation uses hashes |

The live JavaScript SHA-256 is `9b348c72212dcf68fdacb0ae79df817f3305fd666ac984737a3f09e4a873f425`.

The deployed JavaScript contains the original `/api/auth/` integration and no `lockboxProof` native bridge. No HTTP URLs to localhost or 127.0.0.1 were found in that bundle. Source requests are same-origin relative `/api/...` calls. Vite's development-only proxy forwards these to port 8787 locally; that proxy does not accompany a static production build. Starting the owner's local backend cannot supply this Vercel site's missing API.

The account gate expects a session or an authentication response; a Vercel 404 instead produces its account-service error. Login, registration, vault access and Settings cannot be considered working simply because the HTML/assets load. No accounts were created and no registration/login POSTs were sent. No interactive browser login/vault test was performed.

Vercel does support appropriately configured Fastify functions, but that is not this deployment. Moreover, its function filesystem does not provide the shared durable SQLite/key/backup storage expected by this legacy backend. Adapting the backend to hosted storage would contradict the chosen architecture and is not recommended.

## Google Drive findings

There are two distinct implementations; they must not be confused:

| Implementation       | Current integration                                                                                                                                       | Relevance                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Legacy React/Fastify | Browser calls backend Drive routes; confidential web OAuth registration, backend token encryption and central SQLite state; requests full `drive` scope   | Not operational on this Vercel origin and unsuitable as the permanent local-first design              |
| Windows proof        | Native direct Drive v3 requests, system browser, PKCE S256, random state, short-lived loopback callback, OS-protected native tokens; default `drive.file` | Suitable basis for the bounded Windows feasibility test; real Google authorisation remains unverified |

`proof/windows/native-config.json` is absent. The tracked example contains a placeholder public client ID. Latest existing proof evidence explicitly says `externalGoogle: NOT RUN`, `simulatedTransport: true`, `completeLiveProofPassed: false`. There is no evidence of real two-account Drive consent, upload or download. The live Vercel application cannot complete its existing callback route because the backend routes are missing. The proof's supported native OAuth is real implementation code; its successful automated Google responses are fixtures, not real integration evidence.

Desktop PKCE plus a temporary loopback listener is appropriate for Windows. That listener is local and temporary, not a central always-running backend. It must not be copied unchanged to Android or iPhone: Google deprecates loopback redirects for those client types. Mobile needs platform registrations and supported native authorisation/redirect handling, with platform secure token storage. Do not embed a web client secret in any app or Vite variable.

`drive.file` supports per-file Drive operations and Picker-granted access. It does not mean unrestricted folder-tree access. Google account sharing permissions and the user's app authorisation must both permit each file. The outstanding live test must establish visibility of existing **and newly created** files across two independent Google accounts, restart and reconnection, and later across the platform-specific clients. The proof currently authorises folders and uses immutable child-file journals; that behaviour is not proven adequate by fixture tests. Do not widen scopes to conceal a failure. The optional proof full-Drive setting requires explicit configuration; it was not enabled. The legacy connector's unconditional full-Drive request must not be carried forward silently.

Personal vault keys are independent. A signed Household invitation transfers a recipient-encrypted Household key, not a Personal key. Drive permissions alone do not establish membership. The central folder owner can see partner ciphertext/metadata and control availability, but should not receive the partner's Personal key. This separation is supported by code and fictional tests, not yet a real two-account cloud demonstration. The partner must authorise their own Google account.

Vault documents, including credential names, usernames, URLs, notes and folders, are sealed locally before persistence. Native synchronisation carries encrypted envelopes plus signed public routing/history/membership metadata. Master passwords and plaintext credentials are not intended upload fields; strict envelope contracts reject extra credential fields. This is source/test evidence, not inspection of a live Google upload. Encrypted data can still leak metadata such as identities, size and timing.

### Exact external developer dependencies

1. Access to a developer-controlled Google project with Drive API v3 and Google Picker enabled; this project's actual configuration cannot be established from the repository.
2. A registered Desktop public OAuth client for the Windows package, supplied through the ignored developer build configuration. No distributed client secret.
3. Consent audience, branding and test-user configuration for two disposable Google accounts, followed by real independent user approvals. External Testing-mode Drive refresh tokens can expire after seven days; production publishing/reconnection behaviour must be considered before household use.
4. Platform-specific Android/iOS registrations, application identities and signing details when those clients are implemented; a separate extension/native-bridge decision for Chromium support.

These are developer tasks, not instructions for the owner to use Cloud Console or terminals. No external registration, consent or scope change was performed during this audit.

## Security observations

- HTTPS and HSTS are active. The root HTML lacks CSP, frame restrictions (`frame-ancestors`/`X-Frame-Options`), `X-Content-Type-Options` and an explicit `Referrer-Policy`. The legacy Caddy configuration contains protections that Vercel has not inherited. These need deliberate static-host configuration before any security-sensitive web use.
- Root static HTML returns `Access-Control-Allow-Origin: *`. Public static resources do not contain account data; this alone is not a credentialed CORS vulnerability. No working backend was available to verify runtime session cookies, CSRF, rate limiting or API authorisation. Source-level protections must not be reported as deployed protections.
- Source backend cookie configuration uses Secure/HttpOnly/SameSite and the `__Host-` prefix for HTTPS, with exact-origin and CSRF checks and account-scoped ciphertext queries. These are legacy source controls, not evidence of an operational Vercel backend.
- No sensitive tracked runtime-file paths were found among 209 tracked files. A recognisable-secret pattern scan found no Google API keys/client secrets/access/refresh tokens, private-key headers or GitHub tokens in tracked working files, the deployed main JavaScript, or 219 Git history blobs across three commits. This bounded scan is not proof that every possible secret was absent. No private values were printed.
- HEAD checks for `/.env`, `/server/.env`, `/.git/config`, `/server/.data/`, `/server/.data/db/lockbox.sqlite`, `/proof/windows/native-config.json`, `/backups/`, `/deploy/lockbox.service` and the main JavaScript source map all returned 404. This establishes no exposure at those checked paths, not a universal guarantee about every possible URL, old deployment or backup location.
- Do not upload databases, key files, tokens, personal backups or native profiles to Vercel or public GitHub. No such uploads or access changes were made.
- The Windows proof still needs independent protocol/security review, portable encrypted identity recovery, device enrollment/revocation and key rotation, usable conflict resolution and live scope tests before real use. A device-bound DPAPI file is not a cross-device recovery system. Existing local hardening must be reviewed/committed before anyone packages from GitHub.

## Required direction and owner action

Keep the existing web application and its data intact as the legacy local installation. Preserve the Windows proof. Use Vercel only as an optional clearly labelled information/download surface; do not make a missing central backend the next hosting project. Reuse the existing React components, client encryption, generation and tested native sync work while completing native identity, recovery, mobile and paired extension gaps. The existing extension approves operations through a web-app tab; it is not yet a backend-independent desktop bridge. No mobile application package exists in the inspected repository.

Before migration, pass the existing fictional-data two-account Windows live acceptance test, establish a tested encrypted backup/restore path and obtain explicit migration approval. Neither person's computer should have to act as a server for the other; each installation must synchronise directly with Drive when it is online. No new hosting service or database is proposed.

No technical setup is needed from the owner now. Do not enter real credentials into the public site or fictional desktop proof. If completing the private Vercel dashboard portion is desired, browser access must first be approved; the previous access prompt expired. No need to reveal environment-variable values or configure them manually.

Only this audit document was added in this audit turn. No application code, environment configuration, accounts, database, deployment, Google permissions or existing proof files were changed. Builds and mutating application tests were not rerun for this documentation-only audit; the checks above were anonymous read-only HTTP, repository inspection and bounded secret-pattern scans.

## Primary references checked

- [Fastify on Vercel](https://vercel.com/docs/frameworks/backend/fastify)
- [Vercel: SQLite and permanent filesystem storage](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- [Google native/desktop OAuth and redirect constraints](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google Drive scopes and per-file access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker for desktop and mobile](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)
- [Google OAuth client types and refresh-token expiration](https://developers.google.com/identity/protocols/oauth2)
- [Chromium identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
