import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { VaultEngine, VaultHistoryEntry } from './engine'
export function VaultHistory({
  engine,
  onChanged,
}: {
  engine: VaultEngine
  onChanged: () => void
}) {
  const [entries, setEntries] = useState<VaultHistoryEntry[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
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
            void engine
              .history()
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
                  void engine
                    .historicalVault(x.id)
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
