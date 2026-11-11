# Lockbox for Windows — preview

> Current Google integration status: [live qualification and security gates](docs/google-drive-live-qualification.md). Preview 0.2.1 keeps ordinary-vault cloud uploads blocked; real Google testing uses separate fictional profiles. Earlier evidence below is historical.

The Windows application is the primary product direction. Its source remains in `proof/windows` so that the existing working proof, encrypted profiles and interface are preserved. The root web build is the legacy server-dependent application; it is not the Windows app. The Vercel site has not been changed.

**Use fictional credentials only. Real Google Drive, physical two-computer operation, device revocation and independent security review are not yet validated.**

## Installing without a terminal

1. Open the preview package supplied by the maintainer. If it is a ZIP, choose **Extract All** first. Keep the entire extracted folder together.
2. Double-click **LockboxSetup.exe**.
3. Choose **Install for household owner** on the owner's computer, or **Install for partner** on the partner's computer.
4. Open **Lockbox Preview - owner** or **Lockbox Preview - partner** from the Windows Start menu.
5. Create a master password, save the recovery information privately and enter the full recovery key to confirm it.

The installer creates a new version directory in your own Windows profile and a Start menu shortcut. It does not require administrator access, replace old versions, touch the legacy database or move existing vault data. You can also open **Lockbox.exe** directly without installing; choose the correct role before creating a vault.

The package is an unsigned preview. Its checksums detect corruption, not publisher authenticity. If Windows blocks it, stop and tell the maintainer; do not bypass the warning.

## What you can try now

- Add, edit, delete, search and categorise fictional credentials.
- Create and rename folders; move credentials between your Personal and local Household vaults.
- Generate a password and use it in a new credential.
- Reveal and explicitly copy passwords. The native application attempts to clear its own clipboard copy after 30 seconds and on locking. Other clipboard contents are preserved; clipboard history is not erased.
- Lock the vault and unlock it again. Inactivity locks both the interface and native device keys.
- Close and reopen the app while offline. Saved encrypted data remains on this computer.
- In Settings, verify the recovery key, change the master password, or save an encrypted portable backup.

Each installation has a separate encrypted identity and Personal Vault. A local Household Vault can be created before Google is connected. It remains local until Household pairing and cloud permissions are configured. Creating a Household does not automatically give another person its key.

## Google Drive

The code supports independent native Google authorisation, but this build has no registered Google application configured. **Connect is unavailable until the developer supplies that registration.** This is not something you need to configure in Google Cloud or a terminal.

Once enabled, each person will choose **Connect my Google account** and approve Google using their own account. Neither person shares their Google password or uses the other's account. Real two-account file permissions and synchronisation still need to pass testing. No broader Drive permission will be chosen automatically.

## Backup and recovery

In Settings, choose **Save encrypted portable backup**, enter the master password and select a private destination outside website/application folders. Save a copy off this computer. Google tokens are excluded. Do not put the backup in a public folder or upload it to the website.

On a new, empty installation with the matching owner/partner role, choose **Choose encrypted backup**. Restore using the master password valid when the backup was created. If it was forgotten, select recovery, enter that backup's recovery key and choose a new master password. Save and verify the replacement recovery key before completing restoration. Reconnect Google separately afterward.

Restoration refuses to overwrite an existing vault. Older backups require their own matching password or recovery information. A backup containing unresolved Personal conflicts currently needs its original master password for restoration before those conflicts can be reviewed.

**Recovery restores the backed-up device identity. It does not revoke a lost device or invalidate old copies.** Device enrollment, revocation and key rotation remain release blockers. Keep previews and backups fictional.

## Conflicts

Settings can load and locally decrypt encrypted history. Choose explicitly which complete conflicting version to keep. All encrypted branches remain retained. After resolving, missing entries from another retained version can be restored without replacing existing live entries. This is whole-version selection, not automatic per-field merging.

## Current evidence

See [the implementation and security report](docs/windows-local-first-status.md) and [packaged test results](docs/native-proof-results.json). Simulated Google tests are identified explicitly. Nothing in this preview should be treated as production-security certification.
