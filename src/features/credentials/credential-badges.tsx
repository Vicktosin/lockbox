import { Users, UserRound } from 'lucide-react'
import type { Credential, Vault } from './types'
import { cn } from '@/lib/utils'

export function SiteIcon({
  credential,
  large = false,
}: {
  credential: Pick<Credential, 'name' | 'color'>
  large?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'site-icon',
        `site-${credential.color}`,
        large && 'site-icon-large',
      )}
    >
      {credential.name.slice(0, 1).toUpperCase()}
    </span>
  )
}
export function VaultBadge({ vault }: { vault: Vault }) {
  const Icon = vault === 'shared' ? Users : UserRound
  return (
    <span className={cn('vault-badge', vault === 'shared' && 'vault-shared')}>
      <Icon size={12} />
      {vault === 'shared' ? 'Shared' : 'Personal'}
    </span>
  )
}
