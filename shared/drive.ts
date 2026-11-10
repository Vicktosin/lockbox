export interface DriveStatus {
  configured: boolean
  connected: boolean
  state: 'disconnected' | 'connected' | 'reauth-required'
  administrator: boolean
  account: string | null
  folder: { id: string; name: string } | null
  lastSync: number | null
  error: string | null
  retryAt: number | null
  syncing: boolean
  conflict: {
    id: string
    createdAt: number
    cloudCopies: { hash: string; createdAt: number }[]
    canResolve: boolean
    approvedCopy: string | null
    waitingForOthers: boolean
  } | null
  namespaces: {
    label: string
    namespace: string
    revision: number
    lastSync: number | null
  }[]
  signInAgain?: boolean
}
