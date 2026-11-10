export type UserId = 'emmanuel' | 'partner'
export type Vault = 'personal' | 'shared'
export type Page =
  'dashboard' | 'library' | 'personal' | 'shared' | 'generator' | 'settings'
export type Category =
  | 'Work'
  | 'Personal'
  | 'Finance'
  | 'Entertainment'
  | 'Shopping'
  | 'Social'
  | 'Travel'
export interface Credential {
  id: string
  name: string
  url: string
  username: string
  password: string
  notes: string
  category: Category
  vault: Vault
  owner: UserId
  createdAt: string
  color: string
  folderId?: string
}
export type CredentialDraft = Omit<Credential, 'id' | 'createdAt' | 'color'>
export const categories: Category[] = [
  'Work',
  'Personal',
  'Finance',
  'Entertainment',
  'Shopping',
  'Social',
  'Travel',
]
export const users: Record<
  UserId,
  { name: string; initials: string; email: string }
> = {
  emmanuel: { name: 'Emmanuel', initials: 'ET', email: 'emmanuel@example.com' },
  partner: { name: 'Partner', initials: 'PT', email: 'partner@example.com' },
}
export const pageLabels: Record<Page, string> = {
  dashboard: 'Overview',
  library: 'Password library',
  personal: 'Personal vault',
  shared: 'Shared vault',
  generator: 'Password generator',
  settings: 'Settings',
}
