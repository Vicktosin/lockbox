import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import type { VaultEngine } from './engine'
import { VaultHistory } from './history'
export function VaultSettings({
  engine,
  onChanged,
  onLock,
}: {
  engine: VaultEngine
  onChanged: () => void
  onLock: () => void
}) {
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [recovery, setRecovery] = useState(''),
    [household, setHousehold] = useState(''),
    [sharingKey, setSharingKey] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [replacement, setReplacement] = useState(''),
    [replaceConfirmation, setReplaceConfirmation] = useState('')
  async function run(action: () => Promise<void> | void) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      onChanged()
    } catch (reason) {
      if (engine.locked) onLock()
      else
        setError(
          reason instanceof Error ? reason.message : 'Vault operation failed.',
        )
    } finally {
      setBusy(false)
    }
  }
  function changeMaster(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await engine.changeMaster(current, password, confirmation)
      setCurrent('')
      setPassword('')
      setConfirmation('')
      setNotice(
        'Master password changed. Existing credentials and recovery key are unchanged. Other unlocked tabs keep their keys until they lock.',
      )
    })
  }
  return (
    <div className="vault-settings">
      <section className="panel settings-panel">
        <div className="settings-body">
          <h2>Master password</h2>
          <p className="field-hint">
            Separate from account login. This change only rewraps your vault
            key; it does not rewrite saved credentials.
          </p>
          <form onSubmit={changeMaster}>
            <Field label="Current master password" htmlFor="master-current">
              <Input
                id="master-current"
                disabled={busy}
                type="password"
                autoComplete="off"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </Field>
            <Field label="New master password" htmlFor="master-new">
              <Input
                id="master-new"
                disabled={busy}
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Field label="Confirm new master password" htmlFor="master-confirm">
              <Input
                id="master-confirm"
                disabled={busy}
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={256}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
              />
            </Field>
            <Button disabled={busy}>Change master password</Button>
          </form>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="settings-body">
          <h2>Verify your recovery key</h2>
          <p className="field-hint">
            Verification is local and does not send the key to the backend. To
            recover a forgotten master password, lock the vault and choose Use a
            recovery key. Recovery replaces the recovery key after confirmation.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void run(() => {
                engine.verifyRecovery(recovery)
                setRecovery('')
                setNotice('Recovery key verified successfully.')
              })
            }}
          >
            <Field label="Recovery key to verify" htmlFor="settings-recovery">
              <Input
                id="settings-recovery"
                autoComplete="off"
                type="password"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                required
              />
            </Field>
            <Button disabled={busy}>Verify recovery key</Button>
          </form>
          <h3>Lost your vault recovery key?</h3>
          <p>
            If you still know your master password, replace the recovery key
            here. Save the replacement outside Lockbox. Your old key will stop
            working with the current vault profile; old backups cannot be
            recalled.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                const next = await engine.replaceRecovery(
                  current,
                  replaceConfirmation,
                )
                setReplacement(next)
                setCurrent('')
                setReplaceConfirmation('')
                setNotice('Recovery key replaced. Save the new key now.')
              })
            }}
          >
            <Field
              label="Master password to replace recovery key"
              htmlFor="replace-recovery-master"
            >
              <Input
                id="replace-recovery-master"
                type="password"
                autoComplete="off"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field
              label="Type REPLACE to confirm"
              htmlFor="replace-recovery-confirm"
            >
              <Input
                id="replace-recovery-confirm"
                required
                value={replaceConfirmation}
                onChange={(e) => setReplaceConfirmation(e.target.value)}
              />
            </Field>
            <Button disabled={busy} variant="outline">
              Replace vault recovery key
            </Button>
          </form>
          {replacement && (
            <>
              <textarea
                aria-label="Replacement vault recovery key"
                className="form-input recovery-key"
                readOnly
                value={replacement}
              />
              <CopyButton
                value={replacement}
                label="Copy replacement recovery key"
                showLabel
                onError={setError}
              />
              <Button variant="ghost" onClick={() => setReplacement('')}>
                I saved it — hide key
              </Button>
            </>
          )}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="settings-body">
          <h2>Household vault</h2>
          {!engine.household ? (
            <>
              <p className="field-hint">
                The administrator creates the Household vault, then grants the
                other account access and privately transfers its key. Use
                Refresh vault after an invitation.
              </p>
              <Button
                disabled={busy}
                onClick={() => void run(() => engine.createHousehold())}
              >
                Create Household vault
              </Button>
            </>
          ) : !engine.household.joined ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  await engine.joinHousehold(household)
                  setHousehold('')
                  setNotice('Household vault unlocked for this account.')
                })
              }}
            >
              <Field
                label="Household key from its owner"
                htmlFor="household-key"
              >
                <Input
                  id="household-key"
                  autoComplete="off"
                  value={household}
                  onChange={(e) => setHousehold(e.target.value)}
                  required
                />
              </Field>
              <Button disabled={busy}>Join Household vault</Button>
            </form>
          ) : (
            <>
              <p className="field-hint">
                Joined accounts can read, edit, move and delete all Household
                contents. Personal contents stay separate. Removing access
                rotates the key for future saves; it cannot recall copied
                secrets or old snapshots.
              </p>
              {engine.household.ownerId === engine.userId && (
                <>
                  {engine.candidates.map((account) => (
                    <Button
                      key={account.id}
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await engine.grantHousehold(account.id)
                          setNotice(
                            'Account access granted. Transfer the Household key privately to ' +
                              account.username +
                              '.',
                          )
                        })
                      }
                    >
                      Grant access to {account.username}
                    </Button>
                  ))}
                  {engine.candidates
                    .filter(
                      (account) => account.access && account.access !== 'none',
                    )
                    .map((account) => (
                      <Button
                        key={'revoke-' + account.id}
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await engine.revokeHousehold(account.id)
                            setSharingKey('')
                            setNotice(
                              'Household access removed and its encryption key rotated. Previously copied secrets cannot be recalled.',
                            )
                          })
                        }
                      >
                        Remove access for {account.username}
                      </Button>
                    ))}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(() => setSharingKey(engine.exportHousehold()))
                    }
                  >
                    Show Household transfer key
                  </Button>
                  {sharingKey && (
                    <>
                      <textarea
                        aria-label="Household transfer key"
                        className="form-input recovery-key"
                        readOnly
                        value={sharingKey}
                      />
                      <CopyButton
                        value={sharingKey}
                        label="Copy Household key"
                        showLabel
                        onError={setError}
                      />
                      <Button variant="ghost" onClick={() => setSharingKey('')}>
                        Hide Household key
                      </Button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>
      <p className="field-hint">
        Vaults lock after five minutes of inactivity, on page exit, or on
        logout. Deadlines are checked when returning to a background tab.
        Clipboard clearing is attempted after 30 seconds; OS clipboard history
        cannot be erased by this app.
      </p>
      <VaultHistory engine={engine} onChanged={onChanged} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
