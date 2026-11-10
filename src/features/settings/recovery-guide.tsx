import { useState } from 'react'
const scenarios = {
  login: [
    'Forgotten login password',
    'Choose Recover login on the sign-in screen. Use your saved login recovery code and choose a new login password. Then unlock your vault with its separate master password or vault recovery key. Save a replacement login code afterward.',
  ],
  master: [
    'Forgotten master password',
    'Sign in, choose Use a recovery key on the locked vault, and enter your vault recovery key. Choose a new master password and verify the new recovery key. Your login password alone cannot unlock saved passwords.',
  ],
  key: [
    'Lost recovery key',
    'If your login still works, replace its login recovery code in Settings. If you know your master password, replace the vault recovery key in Vault Settings. The administrator can reveal the emergency backup key again after proving their login password while the server is intact.',
  ],
  device: [
    'Lost device or sessions',
    'Use a trusted replacement device to sign in and unlock. Revoke lost-device sessions in Settings. Lockbox cannot erase passwords already copied from a stolen unlocked device.',
  ],
  google: [
    'Google access revoked',
    'Local vault data stays encrypted and usable. Ask the administrator to open Google Drive Settings and reconnect through Google consent. Check both vault sync and off-device backup status afterward. Your partner never needs the Google account.',
  ],
  server: [
    'Damaged database or lost server',
    'Ask your Lockbox maintainer to start the private recovery assistant on a clean installation. Supply the emergency backup record saved separately from Google Drive and approve Google consent. The assistant downloads and verifies an encrypted backup, restores into an empty installation, and leaves existing installations untouched. Both users then recover login using the saved codes and unlock their own vaults. Reconnect Drive, replace login recovery codes and verify a new off-device backup.',
  ],
  lost: [
    'All proof lost',
    'A lost master password plus lost vault recovery key makes Personal decryption unrecoverable, unless a still-unlocked trusted device retains access. An authorised partner may still recover Household data. Losing both login password and login recovery code has no automatic or partner override. A complete server loss without the emergency backup key makes encrypted complete backups unusable. No Google login or administrator reset bypasses vault encryption.',
  ],
} as const
export function RecoveryGuide() {
  const [scenario, setScenario] = useState<keyof typeof scenarios>('login')
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>Recovery assistant</h2>
        <p>
          Choose what happened. Keep login codes, vault recovery keys and the
          emergency backup record clearly labelled and outside Lockbox. Keep the
          emergency record separate from cloud backup files; use a securely
          stored printed copy or another protected location.
        </p>
        <label htmlFor="recovery-scenario">What do you need help with?</label>
        <select
          className="form-input"
          id="recovery-scenario"
          value={scenario}
          onChange={(e) =>
            setScenario(e.target.value as keyof typeof scenarios)
          }
        >
          {Object.entries(scenarios).map(([key, [label]]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <p role="status">{scenarios[scenario][1]}</p>
      </div>
    </section>
  )
}
