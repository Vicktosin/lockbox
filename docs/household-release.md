# Controlled household release

For the current low-cost hosting comparison, private staging option and automated profile-specific preparation, see [private online deployment](private-online-deployment.md). This does not authorize public deployment or migrate existing local data.

The application is a release candidate, not yet approved for real secrets. Google live authorisation/remote restoration, an actual Linux service rehearsal, full interactive acceptance and independent security review are still gates. Local test success does not establish production security.

## Owner experience

The maintainer supplies the approved HTTPS address and privately delivers a single-use owner registration link (expires after 24 hours). Open that link, choose your username and login password, create a separate master password, and save your vault recovery key and login recovery code outside Lockbox. Keep the household emergency backup key offline and separate from backups.

In Settings connect Google Drive, paste the private folder link and approve Google's genuine permission screen. Configure the separate off-device backup folder through Settings. Sync is not a complete server backup. Confirm the backup status and last successful delivery before relying on it. Do not make either folder public.

Invite the second account from Account settings, transfer its invitation privately, and grant Household access. Transfer the Household key privately using Vault settings. Both accounts must save their own login recovery code and vault recovery key. Each account keeps its own Personal vault. The second user never receives the administrator's Google credentials or OAuth tokens.

Lost login: use the login recovery code. Lost master password: use the vault recovery key. Losing both master password and vault recovery key cannot be bypassed. A complete server loss additionally needs the offline emergency backup key and the maintainer's recovery assistant. Old copied secrets and snapshots cannot be recalled by revocation.

## Maintainer installation (not owner setup)

1. Validate Node 24, Caddy and systemd on the private Linux target. Build and run all checks on the release source. `npm run release:package` creates a new allowlisted directory and SHA-256 inventory. It contains no database, keys, environment, extension candidate or node_modules. Compare its inventory through a trusted channel. Install runtime dependencies with `npm ci --omit=dev` on the target and stage it at `/opt/lockbox` with root-owned application files, readable by the service and Caddy, and no service write access to code.
2. Prepare a root-owned mode-600 deployment file outside the release. Use HTTPS origin and distinct `/var/lib/lockbox/db/lockbox.sqlite`, `/var/lib/lockbox/keys/application-key.json`, `/var/lib/lockbox/backups` paths. Supply the maintainer's registered Google OAuth client ID and secret there. This remains a deployment dependency; the owner does not visit Google Cloud Console or edit environment files. Follow `docs/google-maintainer-checklist.md` in the source repository for scope, redirect URI and publication requirements.
3. Run `sh /opt/lockbox/deploy/install-linux.sh /protected/backend.env`. The helper validates production configuration, creates protected storage, binds keys to the database, creates the emergency backup key and writes the private owner invitation to the keys/handoff directory. It preserves existing accounts and keys and fails closed when an existing database lacks its key. It installs but never enables or starts the systemd unit. Copy the emergency key securely offline; never put it beside remote backups. Privately deliver the owner link without printing it in logs or a shared terminal. An expired owner invitation requires deliberate maintainer renewal using the existing invitation utility, not public first-claim registration.
4. With explicit deployment approval, configure the approved hostname in Caddy, validate `caddy validate`, `systemd-analyze verify`, service sandbox and filesystem permissions; then start and verify the service and Caddy. Check HTTPS certificate trust, health check, secure cookies, recovery, two-account isolation, Drive live sync, concurrent conflict handling and physical off-device restore before accepting real credentials. Do not expose port 8787, the recovery assistant or SQLite to the internet. No public deployment is performed by the preparation scripts.

The maintainer handles installation, Google registration, configuration, backup-key custody and restore assistance. No secure live address has been provisioned by this repository work. Do not substitute Vite development/preview hosting for production HTTPS.

## Extension candidate

`npm run build:extension` prepares `extension/dist` for maintainer validation. It is excluded from the household release. It detects conventional top-frame forms, generates passwords, captures entered credentials for explicit save/update approval, and fills only an exact HTTPS origin after an approval in unlocked Lockbox Settings. It never submits forms. Grant only the Lockbox app origin; target-site access uses activeTab. Storage contains only the app origin, never passwords or tokens. Enable the preview for a Settings visit to test it; it is disabled by default and forgotten when leaving Settings.

Limitations: no iframe/shadow-DOM forms, no automatic capture after navigation, no silent fill and no promise of compatibility with every website. New-password generation requires explicit autocomplete markers to avoid replacing an old password. Chrome installation/permission workflows, actual extension suspension and end-to-end approval remain unverified; independent review and an approved private distribution/store path are required before inclusion. Optional extension work does not block the core application's release once its own gates pass.
