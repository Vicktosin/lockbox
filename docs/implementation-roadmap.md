# Implementation and release roadmap

Phases 1�6 implemented the existing backend, two accounts, client vault engine, Google adapter, recovery, verified complete backups and archival recovery. No architecture rebuild is needed.

## Phase 7 completed locally

- Audited the actual code and historical reports; added an independent-review briefing and maintainer Google checklist.
- Added password-confirmed administrator invitations and private fragment signup links using existing admission/security constraints.
- Reproduced and fixed Vite backend/private-tree exposure with nonsecret canaries; hardened development serving without changing production vault formats.
- Tested real Chrome 156 and Edge 157 runtime workers, cookies, independent accounts, key recovery, persistence, concurrency and actual TCP interruption in separate disposable profiles. These are diagnostic runtime tests, not full UI or physical-device acceptance.
- Downloaded checksum-verified official portable Caddy v2.11.9, adapted the real production file and ran private TLS/auth/header/origin/error-log/shutdown checks. Added callback-safe runtime log filtering.
- Bounded expensive remote archive operations and verified busy rejection during a real adapter upload in the mock-cloud replacement rehearsal.
- Passed all 134 automated tests, production build and required code checks. No npm dependency or database migration added, and no public deployment or real household credentials used.

See [Phase 7 results and limitations](phase7-release-validation.md), [security review pack](security-review-pack.md) and [developer-only Google checklist](google-maintainer-checklist.md).

## Remaining release acceptance � external/manual gates

1. Developer-owned Google application registration/verification and protected credentials. Execute and record genuine consent, refresh/revoke, folder permissions, encrypted sync, conflicts, remote backups and complete physical cloud-only recovery with disposable data. Current environment is disconnected; no live Google success is claimed.
2. Maintainer manual UI/visual/mobile acceptance and separate physical-device/network tests. Native password-manager UI automation is prohibited by the computer-use guidance; runtime diagnostics and HappyDOM are not substitutes.
3. Actual Linux/systemd and approved production-host validation, public-CA/DNS setup only after approval, representative load/disk/shutdown, monitoring and emergency-key custody rehearsal. Private Caddy tests are not production-public deployment.
4. Independent security review and remediation using the supplied pack. Confirm broad Drive scope, trusted JavaScript/key lifetime, recovery-proof rollback, host/token/backup-key security and archive/resource constraints.
5. Review long-term remote history capacity and deletion resistance. Current archival compaction preserves unique histories and competing branches; there is no destructive cloud reclamation or lost-all-proof bypass.

The owner only opens private invitations, chooses passwords, saves labelled recovery information, approves Google consent and selects folders through Settings. No developer console, environment editing, code or database commands are assigned to household users.

**Do not introduce real credentials until these release gates pass. Public exposure and DNS changes still need explicit approval.**

## Later features

PWA registration/offline persistence, Chrome extension, optional MFA and wider sharing follow the release gate. Extension origin/message/content-script boundaries need their own review; Google tokens/server keys never belong in content scripts. No Supabase or Google Sign-In is introduced.
