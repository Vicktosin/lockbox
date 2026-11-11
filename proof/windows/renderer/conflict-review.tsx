import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form'
import { VaultEngine } from '@/features/vault/engine'
import type { StoredVault, StoredProfile } from '../../../shared/client-vault'
import { api, request } from './native-api'
type Version = {
  id: string
  author: { accountId: string }
  snapshot: { vault: StoredVault; profile?: StoredProfile }
}
export function ConflictReview({
  engine,
  onChanged,
  onLock,
}: {
  engine: VaultEngine
  onChanged: () => Promise<void>
  onLock: () => void
}) {
  const [scope, setScope] = useState('personal'),
    [versions, setVersions] = useState<Version[]>([]),
    [heads, setHeads] = useState<string[]>([]),
    [selected, setSelected] = useState(''),
    [master, setMaster] = useState(''),
    [preview, setPreview] = useState<string[] | null>(null),
    [approved, setApproved] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      if (engine.locked) onLock()
      else
        setMessage(
          error instanceof Error ? error.message : 'Version review failed.',
        )
    } finally {
      setMaster('')
      setBusy(false)
    }
  }
  const version = versions.find((v) => v.id === selected)
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>Conflicts and retained versions</h2>
        <p>
          Choose and decrypt a version before changing anything. Resolving a
          conflict keeps one complete version; unselected encrypted branches
          remain in history. Save a portable backup first. Current master and
          recovery settings are preserved.
        </p>
        <Select
          aria-label="Version vault"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value)
            setVersions([])
            setPreview(null)
            setSelected('')
            setApproved(false)
          }}
        >
          <option value="personal">Personal Vault</option>
          <option value="household" disabled={!engine.household?.joined}>
            Household Vault
          </option>
        </Select>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const all = await request<Version[]>('history', { scope })
              const conflicts = await request<Version[]>('conflicts', { scope })
              setVersions(all)
              setHeads(conflicts.map((v) => v.id))
              setSelected('')
              setPreview(null)
              setApproved(false)
            })
          }
        >
          Load encrypted history
        </Button>
        <Select
          aria-label="Encrypted version"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value)
            setPreview(null)
            setApproved(false)
          }}
        >
          <option value="">Choose a version</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {heads.includes(v.id) ? 'Conflicting: ' : ''}revision{' '}
              {v.snapshot.vault.revision} · {v.id.slice(0, 16)}
            </option>
          ))}
        </Select>
        {version && (
          <>
            <Input
              aria-label="Master password to preview version"
              type="password"
              value={master}
              onChange={(e) => setMaster(e.target.value)}
            />
            <Button
              disabled={busy || !master}
              onClick={() =>
                void run(async () => {
                  const state = await api('state')
                  if (scope === 'personal')
                    state.personal = version.snapshot.vault
                  else
                    state.household = {
                      ...version.snapshot.vault,
                      joined: true,
                    }
                  const temporary = await VaultEngine.unlock(
                    async () => state,
                    engine.userId,
                    master,
                  )
                  try {
                    setPreview(
                      temporary.credentials
                        .filter(
                          (c) =>
                            c.vault ===
                            (scope === 'personal' ? 'personal' : 'shared'),
                        )
                        .map((c) => c.name),
                    )
                  } finally {
                    temporary.lock()
                  }
                })
              }
            >
              Decrypt selected version locally
            </Button>
          </>
        )}
        {preview && version && (
          <>
            <p>{preview.length} credentials in this version.</p>
            <ul>
              {preview.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
            <Button
              variant="outline"
              disabled={busy || heads.length > 1}
              onClick={() =>
                void run(async () => {
                  await engine.restoreRevision(version.snapshot.vault)
                  await onChanged()
                  setVersions([])
                  setPreview(null)
                  setMessage(
                    'Missing entries restored; existing live entries were preserved.',
                  )
                })
              }
            >
              Restore missing entries only
            </Button>
            {heads.length > 1 && heads.includes(version.id) && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />{' '}
                  I choose this entire version. Other updates may need to be
                  restored separately.
                </label>
                <Button
                  disabled={busy || !approved}
                  onClick={() =>
                    void run(async () => {
                      await request('resolve-conflict', {
                        scope,
                        selected: version.id,
                        expectedHeads: heads,
                      })
                      await engine.refresh()
                      await onChanged()
                      setVersions([])
                      setPreview(null)
                      setMessage(
                        'Resolution saved locally. Sync Now publishes it; other encrypted branches remain retained.',
                      )
                    })
                  }
                >
                  Keep selected version and resolve
                </Button>
              </>
            )}
          </>
        )}
        <p role="status">{message}</p>
      </div>
    </section>
  )
}
