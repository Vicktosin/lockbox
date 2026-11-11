import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { destroyKeys, toBase64, unlockProfile } from '@/features/vault/crypto'
import type { VaultEngine } from '@/features/vault/engine'
import { api, request } from './native-api'
export function DesktopSecurity({
  engine,
  onChanged,
  onLock,
}: {
  engine: VaultEngine
  onChanged: () => Promise<void>
  onLock: () => void
}) {
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [recovery, setRecovery] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      await onChanged()
    } catch (error) {
      if (engine.locked) onLock()
      else
        setMessage(
          error instanceof Error ? error.message : 'Security operation failed.',
        )
    } finally {
      setCurrent('')
      setPassword('')
      setConfirmation('')
      setRecovery('')
      setBusy(false)
    }
  }
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>Local vault security and backup</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await engine.changeMaster(current, password, confirmation)
              setMessage(
                'Master password changed. Credentials and device identity are preserved. Create a new portable backup.',
              )
            })
          }}
        >
          <Field label="Current master password" htmlFor="desktop-current">
            <Input
              id="desktop-current"
              type="password"
              autoComplete="off"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New master password" htmlFor="desktop-new">
            <Input
              id="desktop-new"
              type="password"
              required
              minLength={15}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new master password" htmlFor="desktop-confirm">
            <Input
              id="desktop-confirm"
              type="password"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </Field>
          <Button disabled={busy}>Change master password</Button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              engine.verifyRecovery(recovery)
              setMessage(
                'Recovery key verified locally. Keep it separate from your encrypted backup.',
              )
            })
          }}
        >
          <Field label="Verify saved recovery key" htmlFor="desktop-recovery">
            <Input
              id="desktop-recovery"
              type="password"
              required
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
            />
          </Field>
          <Button variant="outline" disabled={busy}>
            Verify recovery key
          </Button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const state = await api('state')
              const keys = await unlockProfile(
                engine.userId,
                state.profile!.data,
                current,
              )
              try {
                const save = request<{ saved: boolean }>('backup-export', {
                  root: toBase64(keys.root),
                })
                destroyKeys(keys)
                setCurrent('')
                const result = await save
                setMessage(
                  result.saved
                    ? 'Portable encrypted backup saved. Keep a copy off this computer. OAuth tokens are excluded.'
                    : 'Backup was not saved.',
                )
              } finally {
                destroyKeys(keys)
              }
            })
          }}
        >
          <Field
            label="Master password to export backup"
            htmlFor="desktop-backup-master"
          >
            <Input
              id="desktop-backup-master"
              type="password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Button variant="outline" disabled={busy}>
            Save encrypted portable backup
          </Button>
        </form>
        <p role="status">{message}</p>
        <p className="field-hint">
          Backups contain encrypted vaults, membership history and wrapped
          identity keys. Restore into an empty installation with its backup
          master password or recovery key. Export a fresh backup after changing
          recovery information. Google authorisation is never included.
        </p>
      </div>
    </section>
  )
}
