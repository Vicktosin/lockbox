import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previous
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={cn('modal', wide && 'modal-wide')}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose()
        }
      }}
      aria-labelledby="modal-title"
      aria-describedby={description ? 'modal-description' : undefined}
    >
      <div className="modal-heading">
        <div>
          <h2 id="modal-title">{title}</h2>
          {description && <p id="modal-description">{description}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {children}
    </dialog>
  )
}
