import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
export function BackupAlert({ onSettings }: { onSettings: () => void }) {
  const [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    const check = () => {
      void fetch('/api/maintenance/status', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error()
          return r.json()
        })
        .then((s) => {
          if (live)
            setMessage(
              !s.offdevice?.configured
                ? 'Set up off-device backup'
                : s.offdevice.error || s.offdevice.stale
                  ? 'Backup needs attention'
                  : '',
            )
        })
        .catch(() => {
          if (live) setMessage('Backup status unavailable')
        })
    }
    check()
    const timer = setInterval(check, 60000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])
  return message ? (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      role="status"
      onClick={onSettings}
    >
      {message}
    </Button>
  ) : null
}
