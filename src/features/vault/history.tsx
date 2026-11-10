import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { StoredVault } from '../../../shared/client-vault.ts'
import type { VaultEngine } from './engine'
interface Entry {
  id: number
  scope: string
  revision: number
  saved_at: number
}
export function VaultHistory({
  engine,
  onChanged,
}: {
  engine: VaultEngine
  onChanged: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  async function request<T>(query = ''): Promise<T> {
    const r = await fetch('/api/vault/history' + query, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(120000),
    })
    if (r.status === 409)
      throw new Error(
        'A backup check is already running. Wait a moment, then try again.',
      )
    if (!r.ok)
      throw new Error('History is unavailable. Sign in and refresh your vault.')
    return r.json()
  }
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>Recover deleted entries</h2>
        <p>
          Previous encrypted revisions are preserved. Recovering adds missing
          entries and folders; it keeps current entries and never replaces a
          newer password. Revisions encrypted with a retired Household key
          require an older complete backup and its recovery material.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void request<{ history: Entry[] }>()
              .then((x) => setEntries(x.history))
              .catch((e) => setError((e as Error).message))
              .finally(() => setBusy(false))
          }}
        >
          Show recent history
        </Button>
        <ul className="account-device-list">
          {entries.map((x) => (
            <li key={x.id}>
              <span>
                {x.scope === 'shared' ? 'Household' : 'Personal'} · revision{' '}
                {x.revision} · {new Date(x.saved_at).toLocaleString()}
              </span>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => {
                  setBusy(true)
                  setError('')
                  setNotice('')
                  void request<{ vault: StoredVault }>('?id=' + x.id)
                    .then((result) => engine.restoreRevision(result.vault))
                    .then(() => {
                      onChanged()
                      setNotice(
                        'Missing entries recovered. Existing entries were kept.',
                      )
                    })
                    .catch((e) => setError((e as Error).message))
                    .finally(() => setBusy(false))
                }}
              >
                Recover missing entries
              </Button>
            </li>
          ))}
        </ul>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </div>
    </section>
  )
}
