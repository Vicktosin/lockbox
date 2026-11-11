import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import {
  destroyKeys,
  recoverProfile,
  rewrapMaster,
  rotateRecovery,
  toBase64,
  unlockProfile,
  type VaultProfile,
} from '@/features/vault/crypto'
import { IdleLock } from '@/features/vault/idle-lock'
import { request } from './native-api'
type Header = { accountId: string; role: string; profile: VaultProfile }
type RecoveryDraft = {
  keys: ReturnType<typeof recoverProfile>
  profile: VaultProfile
  recoveryCode: string
}
export function BackupRestore({
  onRestored,
}: {
  onRestored: () => Promise<void>
}) {
  const [header, setHeader] = useState<Header | null>(null),
    [master, setMaster] = useState(''),
    [code, setCode] = useState(''),
    [useRecovery, setUseRecovery] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [verifiedCode, setVerifiedCode] = useState(''),
    [draft, setDraft] = useState<RecoveryDraft | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const pending = useRef<RecoveryDraft | null>(null)
  useEffect(() => {
    const idle = new IdleLock(() => {
      if (pending.current) destroyKeys(pending.current.keys)
      pending.current = null
      setDraft(null)
      setMaster('')
      setCode('')
      setConfirmation('')
      setVerifiedCode('')
      setHeader(null)
    })
    const touch = () => idle.touch(),
      timer = setInterval(() => idle.check(), 1000)
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => {
      idle.stop()
      clearInterval(timer)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      if (pending.current) destroyKeys(pending.current.keys)
    }
  }, [])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Backup could not be restored.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="settings-body" aria-label="Restore encrypted backup">
      <h2>Restore on a new installation</h2>
      <p>
        Open a portable encrypted backup. Existing vaults are never overwritten.
        Choose the matching owner or partner installation first. Google must be
        reconnected after restoring.
      </p>
      <Button
        variant="outline"
        disabled={busy || Boolean(draft)}
        onClick={() =>
          void run(async () => {
            setHeader(await request<Header | null>('backup-inspect'))
            setMaster('')
            setCode('')
          })
        }
      >
        Choose encrypted backup
      </Button>
      {header && !draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              if (useRecovery) {
                const keys = recoverProfile(
                  header.accountId,
                  header.profile,
                  code,
                )
                try {
                  const profile = await rewrapMaster(
                    header.accountId,
                    header.profile,
                    keys,
                    master,
                    confirmation,
                  )
                  const value = {
                    keys,
                    ...rotateRecovery(header.accountId, profile, keys),
                  }
                  pending.current = value
                  setDraft(value)
                } catch (error) {
                  destroyKeys(keys)
                  throw error
                }
              } else {
                const keys = await unlockProfile(
                  header.accountId,
                  header.profile,
                  master,
                )
                try {
                  const restore = request('backup-restore', {
                    root: toBase64(keys.root),
                  })
                  destroyKeys(keys)
                  await restore
                  await onRestored()
                } finally {
                  destroyKeys(keys)
                }
              }
              setMaster('')
              setCode('')
              setConfirmation('')
            })
          }}
        >
          <p>
            Backup for {header.role}. Use the master password or recovery
            information valid when this backup was created.
          </p>
          <label>
            <input
              type="checkbox"
              checked={useRecovery}
              onChange={(e) => setUseRecovery(e.target.checked)}
            />{' '}
            I need to recover a forgotten master password
          </label>
          {useRecovery && (
            <Field label="Backup recovery key" htmlFor="backup-recovery">
              <Input
                id="backup-recovery"
                type="password"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          )}
          <Field
            label={
              useRecovery ? 'New master password' : 'Backup master password'
            }
            htmlFor="backup-master"
          >
            <Input
              id="backup-master"
              type="password"
              required
              minLength={15}
              value={master}
              onChange={(e) => setMaster(e.target.value)}
            />
          </Field>
          {useRecovery && (
            <Field label="Confirm new master password" htmlFor="backup-confirm">
              <Input
                id="backup-confirm"
                type="password"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
          )}
          <Button disabled={busy}>
            {useRecovery ? 'Prepare recovery' : 'Restore encrypted backup'}
          </Button>
        </form>
      )}
      {draft && (
        <>
          <p>
            Save this replacement recovery key privately and enter it below to
            verify it before restoration.
          </p>
          <textarea
            className="form-input recovery-key"
            aria-label="Replacement backup recovery key"
            readOnly
            value={draft.recoveryCode}
          />
          <CopyButton
            value={draft.recoveryCode}
            label="Copy replacement recovery key"
            onError={setMessage}
          />
          <Input
            aria-label="Confirm replacement backup recovery key"
            value={verifiedCode}
            onChange={(e) => setVerifiedCode(e.target.value)}
          />
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (verifiedCode.trim() !== draft.recoveryCode)
                  throw new Error(
                    'Enter the complete replacement recovery key.',
                  )
                try {
                  const restore = request('backup-restore', {
                    root: toBase64(draft.keys.root),
                    replacementProfile: draft.profile,
                  })
                  destroyKeys(draft.keys)
                  await restore
                  pending.current = null
                  setDraft(null)
                  setVerifiedCode('')
                  await onRestored()
                } catch (error) {
                  pending.current = null
                  setDraft(null)
                  throw error
                }
              })
            }
          >
            Verify and restore
          </Button>
        </>
      )}
      <p role="status">{message}</p>
      <p className="field-hint">
        Restoring preserves the backed-up device identity. It does not revoke a
        lost device. Do not use real passwords until device revocation and key
        rotation are validated.
      </p>
    </section>
  )
}
