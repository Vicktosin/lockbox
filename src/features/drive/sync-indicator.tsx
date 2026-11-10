import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DriveStatus } from '../../../shared/drive'
export function SyncIndicator({
  onSettings,
  onExpired,
}: {
  onSettings: () => void
  onExpired: () => void
}) {
  const [text, setText] = useState('Checking cloud status')
  useEffect(() => {
    let live = true,
      pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/drive/status', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        })
        if (response.status === 401) {
          onExpired()
          return
        }
        if (!response.ok) throw new Error()
        const value = (await response.json()) as DriveStatus
        if (live)
          setText(
            value.conflict
              ? 'Cloud conflict — review in Settings'
              : value.error
                ? 'Cloud sync needs attention'
                : !value.connected
                  ? 'Drive not connected'
                  : value.syncing
                    ? 'Cloud sync in progress'
                    : value.namespaces.some(
                          (namespace) => namespace.lastSync === null,
                        )
                      ? 'Cloud sync pending'
                      : 'Synced with Google Drive',
          )
      } catch {
        if (live) setText('Cloud status unavailable')
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [onExpired])
  return (
    <Button variant="ghost" size="sm" onClick={onSettings}>
      {text}
    </Button>
  )
}
