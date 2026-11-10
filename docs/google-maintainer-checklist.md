# Google integration: maintainer-only live setup and acceptance

**Household users do none of the developer-console or environment work below.** The current environment has no developer OAuth client and is disconnected. Existing mocked results are not live Google validation.

## Developer-owned registration

1. In a developer-owned Google Cloud project enable Drive API v3 and configure a confidential **Web application** OAuth client. Configure truthful Lockbox branding, audience, support/privacy information and applicable authorized domains. Keep project ownership separate from the end user's ordinary Drive consent.
2. Register exact callback URIs for the environments actually used. Current local frontend/proxy: `http://localhost:5173/api/drive/callback`. Production: the chosen approved HTTPS origin plus `/api/drive/callback`. Private recovery helper: `http://127.0.0.1:18888/callback`. No wildcard redirects, extra trailing slashes or backend-port callback substituted for the frontend origin.
3. Request `https://www.googleapis.com/auth/drive`. The existing-folder paste experience requires broad Drive scope; drive.file does not independently authorize arbitrary folder IDs. The app does not request Google Sign-In/OpenID identity scopes. Determine the applicable restricted-scope verification/security-assessment requirements or legitimate exception and retain evidence. Never bypass Google warnings as a release substitute.
4. Use disposable test users/data/folders for acceptance. External apps left in Google's Testing status generally receive seven-day refresh tokens for this scope; repeatedly reconnecting is not a production fix. Complete the appropriate production consent/verification process.
5. Supply LOCKBOX_GOOGLE_CLIENT_ID and LOCKBOX_GOOGLE_CLIENT_SECRET through the protected backend deployment environment only. Set the exact LOCKBOX_APP_ORIGIN and production paths/HTTPS requirements. No VITE_ secrets, source commits, browser storage, screenshots of credentials or secrets in logs. Do not ask the owner to edit files or paste developer credentials.
6. Run `npm run validation:environment`. This sanitized inventory reports prerequisites; even a configured/connected result is **not** a live acceptance pass. `-- --require-live` fails the prerequisite gate if configuration/connection is absent. The script never invents a registration or fabricates consent.

Google references: [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [scope classification](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [testing refresh-token lifetime](https://developers.google.com/identity/protocols/oauth2/), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

## Private deployment preparation

Provision the existing database/protected key and first-owner invitation as the maintainer, not the owner. Privately give the owner the invitation link using `APP_ORIGIN/#/join/INVITE_CODE`; do not log it. No public first-claim registration route should be enabled. Once signed in, the administrator can create the partner's invitation from Settings with current-password confirmation. It grants registration only; Household permission/key sharing remains explicit.

Validate deploy/Caddyfile with the official Caddy binary; keep the runtime log filter removing request objects, not just access logging disabled. Use a dedicated OS account, protected separate database/key/backup directories, production HTTPS and same-origin dist-only serving. Validate the actual Linux service with systemd-analyze and a representative host. Do not publish DNS or public listeners without approval. The portable private rehearsal does not validate public CA issuance/systemd/browser UI.

## Disposable-data live acceptance record

Record date, deployed version, actual browser versions, test-account roles, sanitized results and failure/remediation for each check. Never record passwords, master/recovery keys, client secrets, session/OAuth tokens, callback codes/query strings or request headers. Mark each item PASS/FAIL/NOT RUN explicitly; no mock substitution.

| Required live check            | What must be observed                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Administrator consent/callback | Google accepts the registered client/redirect/scope; state is single-use and session-bound; Settings reports the real connected account only afterward                                           |
| Private folder validation      | Paste an owned private My Drive folder; public/shared/non-owned/trashed/unwritable cases fail without making permissions public                                                                  |
| Initial upload/download        | Create synthetic Personal/Household contents; inspect remote bytes for ciphertext only; clean authorized download decrypts on the correct device                                                 |
| Automatic sync                 | Save without pressing Sync Now, verify current encrypted revision and last-success state remotely                                                                                                |
| Both users/devices             | Separate browser profiles and separate physical devices; independent login/master proofs; wife never sees Google credentials or admin Personal data                                              |
| Concurrent writes/conflicts    | Race changes, preserve both heads/copies and require independent whole-copy approvals; stale approval cannot replace newer data                                                                  |
| Network and browser lifecycle  | Interrupt/reconnect, close/reopen, expire/revoke sessions; no plaintext persistence, silent reset or lost acknowledged update                                                                    |
| Token refresh                  | Exercise genuine expired access token refresh and normal subsequent API use; never inspect/print the token itself                                                                                |
| Revoke/reconnect               | Revoke grant through Google, observe reauthorization/error state; reconnect through consent and verify sync/backups resume                                                                       |
| Remote backup                  | Select a separate owner-only backup folder, confirm emergency record saved elsewhere, verify resumable upload/download/authenticated clean restoration and source-date freshness                 |
| Server replacement             | Remove only a disposable installation; fresh helper consent downloads the remote archive using separately held record; recover both accounts and all vaults/history, reconnect and continue sync |
| Disclosure/logging             | Check safe operational logs and error cases for absence of secrets/query codes; verify wife's API cannot retrieve admin Google identity/tokens/private ciphertext                                |

Do not manually delete referenced remote archives or unresolved revisions during acceptance. Cleanup must be restricted to explicitly identified disposable test files; do not change sharing on the owner's central folder.

## Household experience after maintainer setup

Open Lockbox → create the invited account → choose a separate master password → save the labelled recovery information → paste the existing private folder link and select Connect Google Drive → approve Google's permission request → invite the partner from Settings → separately grant Household access and transfer its sharing card privately. The owner also saves the emergency backup record outside Drive and selects a different private backup folder. No developer-console or database commands are assigned to either user.

The current implementation collects the folder link **before** consent, then validates it after Google authorization. It does not use Google Picker or claim the link grants access. This preserves the approved existing-folder flow; the alternative order in the proposed onboarding outline is not a separate Picker implementation.
