# Phase 7: integration and release validation

This phase audits and exercises the existing application rather than rebuilding it. **Not production-ready for real credentials.** Genuine Google registration/consent and physical cloud recovery remain unavailable; complete browser UI acceptance, physical devices, Linux/systemd and independent security review are still outstanding. No public deployment, DNS change, system trust-store change or real household credentials were used.

## Audit findings and changes

Read Phase 1–6 reports and inspected actual authentication, client crypto/worker/engine, Drive provider/service, backup/recovery/history, frontend, Vite and deployment sources. Historical reports describe earlier states; their test counts and inactive-feature statements are not the present release state.

| Finding                                                           | Implementation/result                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Member invitations required a maintainer command                  | Added administrator Settings invitation control and password/session/CSRF-protected API, using existing one-use token transactions and capacity constraints. A private fragment link prefills signup and clears the address-bar capability. No automatic messaging, public owner-claim route or Household grant is introduced.                               |
| Vite defaults could serve backend-tree data                       | Reproduced with a disposable nonsecret canary. Added explicit backend/private-file/raw-filesystem denial, retained Vite default sensitive patterns, loopback binding and exclusion of backend/private trees from frontend watchers. Verified canary/module/environment denial while frontend modules remain available. No real key was fetched or displayed. |
| Disabling Caddy access logs did not cover runtime upstream errors | Added a default runtime-log filter deleting request objects. Actual Caddy test forces an upstream callback failure and verifies synthetic query-code/cookie canaries are absent from captured logs.                                                                                                                                                          |
| Unbounded concurrent archive downloads could consume memory/disk  | Serialized expensive remote archive/delivery/compaction operations. Busy foreground requests return 409 with a friendly retry message; background delivery remains pending for retry. The recovery rehearsal checks an archive request during a held real adapter upload.                                                                                    |
| Recovery footer implied assisted reset already existed            | Corrected copy: loss of both login password and login recovery code has no automatic reset. Master/vault recovery loss cannot be bypassed. Recovery uses new-password autocomplete.                                                                                                                                                                          |
| Older text implied server keys never reach cloud in any form      | Clarified that ordinary vault sync never uploads plaintext server keys; complete archives contain server keys only inside independent emergency-key encryption.                                                                                                                                                                                              |
| Desired onboarding order differed from code                       | Existing approved flow collects a private folder link before consent, validates afterward, and uses no Picker. The maintainer checklist states that order explicitly.                                                                                                                                                                                        |

Existing encryption formats, database schema/migrations, frontend layout and working functionality are preserved. No npm dependency was installed/upgraded. A portable official Caddy v2.11.9 was downloaded into protected ignored test storage, verified against its GitHub-published SHA-256 and used without service installation.

## Actual Google results

**NOT RUN against Google.** Sanitized environment inspection found no developer client configuration and no connected grant. `docs/phase7-environment-results.json` records the evidence without secrets. A folder ID alone is not authorization. No fake client was substituted into a live test, no connected state fabricated, and no household user was asked to use a developer console.

The runtime uses the real REST v3 adapter, backend-only confidential code/PKCE flow, encrypted tokens, refresh/revocation, private owned folder validation, immutable encrypted sync/conflicts and remote backup delivery. Existing Google-response tests remain mocked, including recovery/replacement; they do not establish live success.

[Maintainer-only registration and acceptance checklist](google-maintainer-checklist.md) specifies project/Drive API, exact local/production/private-recovery redirects, required scope, restricted-scope verification or legitimate exception, Testing refresh-token lifetime, protected configuration and every disposable-data live check. Developer registration is an external dependency, not an owner setup task.

## Real browser runtime and separate-client results

`npm run test:browser-runtime` launches installed **Chrome 156** and **Edge 157** headlessly with distinct new private profiles. They open a developer diagnostic page, not the Lockbox UI, and run actual client crypto/worker/engine code and actual backend requests. The controller only manages those diagnostic processes and supplies a synthetic out-of-band Household sharing card; no normal browser profile or real credentials are accessed. Master passwords and unwrapped Personal keys never go to the API. Profiles are removed afterward.

Passed in both contexts:

- Invited registration, actual browser cookies/login and script-inaccessible HttpOnly session.
- Native Argon2id workers/WASM at the existing cost, master setup/incorrect-master rejection and local recovery.
- Encrypted Personal credential create/edit/delete, folder operations, password generation and manual locking.
- Explicit account grant plus out-of-band Household key transfer; private-vault isolation and scoped API selection.
- Concurrent Household writes with a detected revision conflict, refresh/retry and both updates retained.
- Sustained TCP interruption before write dispatch, failed save without ciphertext replacement, reconnection and refresh.
- Independent account recovery followed by unchanged decryptable Personal/Household contents.
- No claimed Google connection/remote backup when developer registration is absent; partner denied administrator backup API.
- Graceful browser closure/reopening with persisted cookie, fresh master unlock, server-side session expiry, login and logout revocation.
- No master/plaintext vault markers in recorded API bodies or vault database rows, and no keys/plaintext in localStorage/sessionStorage.

Evidence: [browser-runtime results](phase7-browser-runtime-results.json). These are **real browser-runtime/API checks, not full UI/visual/mobile or two physical-device tests**. HappyDOM component tests separately exercise the rendered interface, including invitation links/forms; they are not relabelled as real browser UI acceptance.

The [computer-use skill](<C:/Users/Emmanuel Thomas/.codex/plugins/cache/openai-bundled/computer-use/26.1027.30824/skills/computer-use/SKILL.md>) requires following its [Windows guidance](<C:/Users/Emmanuel Thomas/.codex/plugins/cache/openai-bundled/computer-use/26.1027.30824/docs/guidance.md>), which says: “Do not automate password manager apps or password manager websites.” Native password-manager UI automation was therefore not performed. Manual real-UI acceptance remains required; permission/confirmation is not being requested as a substitute for that restriction.

The first runtime attempt used a one-connection drop that Chromium safely retried, so it did not create an actual outage. The harness now holds the outage until explicit reconnection and cleans up failed clients before reopening profiles. The corrected run passes; no KDF, cipher or authorization was weakened.

## Actual private deployment results

`npm run test:caddy` uses the checksum-verified official Caddy binary, not a reimplementation:

1. Actual production Caddyfile adaptation passed.
2. A derived private configuration, retaining headers/proxy/log policy, validated and served over loopback TLS using an ephemeral certificate trusted only by the test client.
3. Static serving, backend health, Secure/HttpOnly/__Host-/SameSite cookie headers, CSP/HSTS/no-store, absent permissive CORS and wrong-Origin rejection passed.
4. Upstream failure produced a 502 while runtime logs omitted synthetic callback/cookie canaries.
5. Graceful stop through the explicitly loopback-bound administrator endpoint passed. No public listener, DNS/ACME issuance or OS root installation occurred.

Evidence: [Caddy results](phase7-caddy-results.json). The initial release-download endpoint timed out; the official asset API succeeded, and its published digest was verified before execution. The initial admin-stop request lacked the accepted same-origin API headers; the corrected legitimate request passed. Neither issue was hidden as a successful first attempt.

The existing Node loopback HTTPS suite remains as separate regression coverage. Actual Linux/systemd execution is **NOT RUN on this Windows host**. The unit's dedicated account, environment, paths, sandboxing and readiness probe were inspected, but inspection is not a live service validation. Actual public CA/DNS, representative-host load/disk/large-backup shutdown and browser production TLS/CSP require the approved deployment environment.

## Backups and restoration

Existing complete local/remote mock-storage restoration tests remain active. The full replacement rehearsal deletes only its disposable original server/database/keys/backups, restores with fresh mocked Google consent and separately held emergency information, recovers both accounts and all vaults/history, reconnects and resumes encrypted sync. It also checks retention of referenced archive fallbacks and the new expensive-operation bound.

**Physical off-device Google restoration is NOT RUN.** Separate profiles and a mock remote store are not separate machines or proof of Google durability. Do not erase/retire backups or introduce real secrets based on those simulations alone. Writable Google folders have deletion/rollback risk; unique archives/competing cloud revisions are not automatically reclaimed.

## Review pack and release decision

[Independent-review briefing](security-review-pack.md) contains architecture, key hierarchy, authentication/recovery, threat model, data-flow diagram, API review map, Google permissions, recovery procedures and retained risks. This is an internal handoff, not independent assessment. Review must cover trusted-JavaScript/XSS, key lifecycle, broad Drive scope, old recovery proof/rollback, resource limits, logging, host isolation and the future extension boundary.

**Remaining release blockers:** genuine registered Google consent/refresh/revoke and physical remote recovery; complete manual UI/mobile/physical-device acceptance; actual Linux/systemd/production ingress and monitoring/key-custody rehearsal; independent security review and fixes. Long-term remote history growth/deletion resistance and loss-of-all-proof limits remain explicit operational constraints.

**Owner actions only after maintainer readiness:** open the private invitation, create the account/master password, save separate labelled login/vault recovery information, approve Google consent after pasting the existing private folder link, invite the partner through Settings, separately grant Household access, and save/confirm the emergency record and separate backup folder. The owner runs no developer-console, code, environment or database commands. Initial first-owner provisioning and all deployment/registration work remain maintainer responsibilities.

No public deployment is authorized by this report. **Real credentials are not yet safe to introduce under the release criteria.** Next work is the maintainer's live disposable-data acceptance record plus independent review and remediation, not an architecture rebuild.

## Changed files and checks

Created: src/features/auth/invitation-panel.tsx; scripts/check-onboarding.mjs, check-dev-boundary.mjs, check-browser-runtime.mjs, browser-runtime/client.mjs, check-caddy.mjs, prepare-caddy.mjs and validate-environment.mjs; the Phase 7 evidence JSON files, this report, google-maintainer-checklist.md and security-review-pack.md.

Modified: server/auth/routes.ts; server/maintenance/offdevice.ts; server/http/app.ts; src/features/auth/account-panel.tsx and auth-screen.tsx; src/features/vault/history.tsx; vite.config.ts; deploy/Caddyfile; scripts/check-frontend.mjs and check-rehearsal.mjs; package.json and current README/architecture/operations/security/roadmap links. **No database migration or dependency change.**

The serial `npm run test:all` command passed all **134 tests**, with zero failed, cancelled or skipped tests. This includes 29 simulated-DOM frontend checks, 3 actual browser-runtime checks, 4 actual Caddy checks, 3 invitation checks, 2 development-boundary checks and all existing authentication/vault/Drive/recovery/deployment suites. Frontend/backend TypeScript, ESLint and the production/PWA build passed. Runtime npm audit reported zero known runtime vulnerabilities. Prettier formatting verification passed. None of these results is independent certification.
