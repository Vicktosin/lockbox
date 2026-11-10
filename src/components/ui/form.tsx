import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('form-input', className)} {...props} />
}
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn('form-input', className)} {...props} />
}
export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string
  htmlFor: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}
