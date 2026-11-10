import { Check, Copy } from 'lucide-react'
import { useRef, useState, useEffect } from 'react'
import { Button } from './button'
import { copySecret } from '@/lib/secure-clipboard'

export function CopyButton({
  value,
  label = 'Copy',
  onError,
  showLabel = false,
}: {
  value: string
  label?: string
  onError: (message: string) => void
  showLabel?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try {
      await copySecret(value, onError)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      onError('Clipboard unavailable. Select and copy the value manually.')
    }
  }
  return (
    <Button
      type="button"
      variant={showLabel ? 'outline' : 'ghost'}
      size={showLabel ? 'default' : 'icon'}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={() => void copy()}
    >
      {copied ? <Check /> : <Copy />}
      {showLabel && (copied ? 'Copied' : label)}
      <span className="sr-only" role="status">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </Button>
  )
}
