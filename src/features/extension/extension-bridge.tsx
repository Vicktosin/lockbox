import { useEffect, useRef, useState } from 'react'
import {
  parseExtensionRequest,
  websiteOrigin,
  type ExtensionRequest,
} from '../../../shared/extension'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { VaultEngine } from '@/features/vault/engine'
import type { UserId } from '@/features/credentials/types'

/** Optional preview. Requests never disclose credentials until the user approves this dialog. */
export function ExtensionBridge({
  engine,
  user,
  onChanged,
}: {
  engine: VaultEngine
  user: UserId
  onChanged: () => void
}) {
  const [enabled, setEnabled] = useState(false),
    [request, setRequest] = useState<ExtensionRequest | null>(null),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const pending = useRef<ExtensionRequest | null>(null)
  function reply(value: Record<string, unknown>) {
    const current = pending.current
    if (current)
      window.postMessage(
        { kind: 'lockbox-extension-response', id: current.id, ...value },
        location.origin,
      )
    pending.current = null
    setRequest(null)
    setSelected('')
    setError('')
  }
  useEffect(() => {
    if (!enabled || engine.locked) return
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return
      if (
        event.data?.kind === 'lockbox-extension-hello' &&
        typeof event.data.id === 'string' &&
        /^[a-f0-9]{64}$/.test(event.data.id)
      ) {
        if (!engine.locked && !pending.current)
          window.postMessage(
            { kind: 'lockbox-extension-ready', id: event.data.id },
            location.origin,
          )
        return
      }
      if (pending.current || engine.locked) return
      try {
        const next = parseExtensionRequest(event.data)
        pending.current = next
        setRequest(next)
        setSelected('')
        setError('')
      } catch {
        /* Unrelated messages are ignored. */
      }
    }
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener('message', receive)
      if (pending.current)
        window.postMessage(
          {
            kind: 'lockbox-extension-response',
            id: pending.current.id,
            approved: false,
          },
          location.origin,
        )
      pending.current = null
    }
  }, [enabled, engine])
  useEffect(() => {
    if (!request) return
    const timer = setTimeout(() => {
      if (pending.current?.id === request.id) {
        window.postMessage(
          {
            kind: 'lockbox-extension-response',
            id: request.id,
            approved: false,
            error: 'Approval expired.',
          },
          location.origin,
        )
        pending.current = null
        setRequest(null)
      }
    }, 40000)
    return () => clearTimeout(timer)
  }, [request])
  const matches =
    request && !engine.locked
      ? engine.credentials.filter((item) => {
          try {
            return websiteOrigin(item.url) === request.origin
          } catch {
            return false
          }
        })
      : []
  async function approve() {
    const current = pending.current
    if (!current || engine.locked || busy) return
    setBusy(true)
    setError('')
    try {
      const item = matches.find((item) => item.id === selected)
      if (current.operation === 'fill') {
        if (!item) throw new Error('Choose a matching saved login.')
        reply({
          approved: true,
          origin: current.origin,
          username: item.username,
          password: item.password,
        })
      } else {
        if (current.operation === 'update' && !item)
          throw new Error('Choose the login to update.')
        const entry = current.entry!
        await engine.saveCredential(
          item
            ? { ...item, username: entry.username, password: entry.password }
            : {
                ...entry,
                url: current.origin,
                notes: '',
                category: 'Personal',
                vault: 'personal',
                owner: user,
              },
          item?.id,
        )
        onChanged()
        if (pending.current?.id === current.id && !engine.locked)
          reply({ approved: true })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approval failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>Browser extension preview</h2>
        <p className="field-hint">
          Optional candidate, excluded from the household release pending
          browser and security review. Enable only while testing the companion
          extension. Every fill, save and update requires approval here.
        </p>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              if (pending.current) reply({ approved: false })
              setEnabled(event.target.checked)
            }}
          />{' '}
          Enable for this Settings visit
        </label>
      </div>
      {enabled && request && (
        <Modal
          title="Approve extension request"
          description={request.origin}
          onClose={() => {
            if (!busy) reply({ approved: false })
          }}
        >
          <p>
            {request.operation === 'fill'
              ? 'Send the selected username and password to this exact HTTPS website. Nothing will be submitted.'
              : request.operation === 'save'
                ? 'Save this captured login in your Personal vault.'
                : 'Replace the selected login’s username and password. Other fields stay unchanged.'}
          </p>
          {request.entry && (
            <>
              <p>
                {request.entry.name} — {request.entry.username}
              </p>
              <input
                className="form-input"
                aria-label="Captured password"
                type="password"
                value={request.entry.password}
                readOnly
              />
            </>
          )}
          {request.operation !== 'save' && (
            <label>
              Matching login
              <select
                className="form-input"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Choose a login</option>
                {matches.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.username} ({item.vault})
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <Button
            disabled={busy || (request.operation !== 'save' && !selected)}
            onClick={() => void approve()}
          >
            Approve {request.operation}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => reply({ approved: false })}
          >
            Cancel
          </Button>
        </Modal>
      )}
    </section>
  )
}
