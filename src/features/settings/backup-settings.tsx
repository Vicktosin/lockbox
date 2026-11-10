import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { CopyButton } from '@/components/ui/copy-button'
import type { AccountSession } from '../auth/api'
interface Status {
  offdevice?: {
    configured: boolean
    folderName: string | null
    folderId: string | null
    lastSuccess: number | null
    sourceCreatedAt: number | null
    error: string | null
    stale: boolean
    archived: { n: number }
  }
  running: boolean
  lastError: string | null
  policy: { backup_days: number; history_days: number }
  backups: { created_at: number; verified_at: number | null; status: string }[]
  restore: unknown
}
export function BackupSettings({ session }: { session: AccountSession }) {
  const [folder, setFolder] = useState(''),
    [proof, setProof] = useState(''),
    [installation, setInstallation] = useState('')
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [password, setPassword] = useState(''),
    [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [days, setDays] = useState(30),
    [historyDays, setHistoryDays] = useState(90)
  const request = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const r = await fetch('/api/maintenance/' + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(120000),
        headers: body
          ? {
              'Content-Type': 'application/json',
              'X-CSRF-Token': session.csrfToken,
            }
          : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (!r.ok)
        throw new Error(
          'Backup service unavailable or access denied. Your last verified backup has not been replaced.',
        )
      return r.json()
    },
    [session.csrfToken],
  )
  useEffect(() => {
    let live = true
    void request<Status>('status')
      .then((s) => {
        if (live) {
          setStatus(s)
          setDays(s.policy.backup_days)
          setHistoryDays(s.policy.history_days)
        }
      })
      .catch(() => {
        if (live)
          setError(
            'Backup status is unavailable. Ask your Lockbox maintainer to check the service.',
          )
      })
    return () => {
      live = false
    }
  }, [request])
  async function act(path: string, body: unknown) {
    setBusy(true)
    setError('')
    try {
      if (path === 'emergency-key') {
        const result = await request<{ key: string; installationId: string }>(
          path,
          body,
        )
        setKey(result.key)
        setInstallation(result.installationId)
        setPassword('')
      } else {
        setStatus(await request<Status>(path, body))
        if (path === 'destination') {
          setProof('')
          setPassword('')
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (session.user.role !== 'administrator') return null
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>Backups and recovery</h2>
        <p>
          Complete encrypted backups run daily while Lockbox is running. A
          backup counts as successful only after a clean restoration test. Keep
          a copy on a separate protected device; a backup on this computer alone
          cannot survive its loss.
        </p>
        <p role="status">
          {status?.backups.find((x) => x.status === 'verified')?.verified_at
            ? `Last verified backup: ${new Date(status.backups.find((x) => x.status === 'verified')!.verified_at!).toLocaleString()}`
            : 'No verified backup reported.'}
          {status?.running ? ' Backup in progress.' : ''}
          {status?.lastError || status?.backups[0]?.status === 'failed'
            ? ' The latest backup failed.'
            : ''}
          {status?.lastError === 'BACKUP_RECOVERY_CODES_REQUIRED'
            ? ' Both users must generate an unused login recovery code in Settings before a complete backup can be verified.'
            : ''}
        </p>
        <Button disabled={busy} onClick={() => void act('backup', {})}>
          Back up now
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void act('policy', { backupDays: days, historyDays })
          }}
        >
          <Field label="Backup retention in days (7–365)" htmlFor="backup-days">
            <Input
              id="backup-days"
              type="number"
              min={7}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Field>
          <Field
            label="History retention in days (7–3650)"
            htmlFor="history-days"
          >
            <Input
              id="history-days"
              type="number"
              min={7}
              max={3650}
              value={historyDays}
              onChange={(e) => setHistoryDays(Number(e.target.value))}
            />
          </Field>
          <Button disabled={busy} variant="outline">
            Save retention
          </Button>
        </form>
        <p className="field-hint">
          At least two verified backups remain. Unique vault history, deleted
          entries and competing cloud updates stay protected; the history window
          never automatically deletes their only copy. Cloud-history compaction
          is not enabled.
        </p>
        <h3>Emergency backup key</h3>
        <p>
          Save this separately from backup files. It protects all accounts’
          complete backup, including server keys and configuration. It is
          different from your personal vault recovery key. Without it a complete
          backup cannot be restored. Only reveal it on a trusted device.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void act('emergency-key', { password })
          }}
        >
          <Field label="Current login password" htmlFor="backup-password">
            <Input
              id="backup-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button disabled={busy} variant="outline">
            Reveal emergency backup key
          </Button>
        </form>
        {key && (
          <>
            <p>
              Save the installation ID with this key:{' '}
              <strong>{installation}</strong>. Also record your separate
              backup-folder link. Keep this emergency record outside Google
              Drive.
            </p>
            <textarea
              aria-label="Emergency backup key"
              className="form-input recovery-key"
              readOnly
              value={key}
            />
            <CopyButton
              value={key}
              label="Copy emergency backup key"
              showLabel
              onError={setError}
            />
            <Button variant="ghost" onClick={() => setKey('')}>
              I saved it — hide key
            </Button>
          </>
        )}
        <h3>Off-device protection</h3>
        <p
          role={
            status?.offdevice?.error || status?.offdevice?.stale
              ? 'alert'
              : 'status'
          }
        >
          {status?.offdevice?.configured
            ? `Backup folder: ${status.offdevice.folderName}. ${status.offdevice.lastSuccess ? 'Last verified delivery: ' + new Date(status.offdevice.lastSuccess).toLocaleString() : 'No verified delivery yet.'} ${status.offdevice.stale ? 'Backup is missing or older than 48 hours.' : ''} ${status.offdevice.error ? 'Delivery needs attention; Lockbox will retry.' : ''}`
            : 'Off-device protection is not configured. Connect Google Drive, then select a separate private backup folder.'}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void act('destination', {
              folderLink: folder,
              keyConfirmation: proof,
              password,
            })
          }}
        >
          <Field
            label="Separate private backup folder link"
            htmlFor="backup-folder"
          >
            <Input
              id="backup-folder"
              type="url"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Confirm the emergency backup key you saved separately"
            htmlFor="backup-proof"
          >
            <Input
              id="backup-proof"
              type="password"
              autoComplete="off"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              required
              minLength={43}
              maxLength={43}
            />
          </Field>
          <Field
            label="Login password to enable off-device protection"
            htmlFor="backup-enable-password"
          >
            <Input
              id="backup-enable-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button disabled={busy}>Enable automatic off-device backups</Button>
        </form>
        <p>
          Backups are encrypted with the separate emergency key before upload.
          Drive never receives that key. Previously verified cloud backups and
          archived unique history are preserved. Folder relocation needs a
          verified maintainer migration once backups exist.
        </p>
        <Button
          disabled={busy || !status?.offdevice?.lastSuccess}
          variant="outline"
          onClick={() => void act('compact', {})}
        >
          Archive old local history safely
        </Button>
        <p>
          {status?.offdevice?.archived.n ?? 0} history revisions archived.
          Archiving verifies the remote complete backup first and keeps recovery
          available through the same history controls. Competing cloud revisions
          are not deleted.
        </p>
        {Boolean(status?.restore) && (
          <p>
            Restoration verified. Accounts require login recovery and Google
            Drive must be reconnected.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <p>
          A clean installation is restored by the Lockbox maintainer, without
          database commands for household users. Restoring never replaces a
          running database.
        </p>
      </div>
    </section>
  )
}
