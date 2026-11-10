import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form'
import type { VaultEngine, VaultFolder } from './engine'
import type { Vault } from '../credentials/types'
export function VaultFolders({
  engine,
  selected,
  onSelect,
  onChanged,
  onLock,
}: {
  engine: VaultEngine
  selected: string
  onSelect: (id: string) => void
  onChanged: () => void
  onLock: () => void
}) {
  const [name, setName] = useState(''),
    [vault, setVault] = useState<Vault>('personal'),
    [editing, setEditing] = useState<VaultFolder | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
      setName('')
      setEditing(null)
      onChanged()
    } catch (reason) {
      if (engine.locked) onLock()
      else
        setError(
          reason instanceof Error ? reason.message : 'Folder operation failed.',
        )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel vault-folders" aria-label="Password folders">
      <div className="folder-filters">
        <Button
          variant={selected ? 'ghost' : 'outline'}
          size="sm"
          onClick={() => onSelect('')}
        >
          All folders
        </Button>
        {engine.folders.map((folder) => (
          <div className="folder-chip" key={folder.id}>
            <Button
              size="sm"
              variant={selected === folder.id ? 'outline' : 'ghost'}
              onClick={() => onSelect(folder.id)}
            >
              {folder.name} · {folder.vault}
            </Button>
            <button
              aria-label={'Rename folder ' + folder.name}
              onClick={() => {
                setEditing(folder)
                setName(folder.name)
                setVault(folder.vault)
              }}
            >
              Rename
            </button>
            <button
              aria-label={'Delete folder ' + folder.name}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await engine.deleteFolder(folder.id, folder.vault)
                  if (selected === folder.id) onSelect('')
                })
              }
            >
              Remove folder
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void run(() => engine.saveFolder(name, vault, editing?.id))
        }}
      >
        <Input
          aria-label="Folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="Folder name"
        />
        <Select
          aria-label="Folder vault"
          value={vault}
          disabled={Boolean(editing)}
          onChange={(e) => setVault(e.target.value as Vault)}
        >
          <option value="personal">Personal</option>
          {engine.household?.joined && (
            <option value="shared">Household</option>
          )}
        </Select>
        <Button disabled={busy}>
          {editing ? 'Save folder' : 'Create folder'}
        </Button>
        {editing && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditing(null)
              setName('')
            }}
          >
            Cancel
          </Button>
        )}
      </form>
      <p className="field-hint">
        Folder names are encrypted. Removing a folder keeps its credentials and
        removes their folder assignment.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  )
}
