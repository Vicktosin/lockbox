import { check } from './errors.mjs'
import { FILE_SCOPE } from './oauth.mjs'
export const cloudBlockers = [
  'Per-device enrollment and revocation are unfinished.',
  'Household encryption/signing-key rotation is unfinished.',
  'Portable recovery currently clones a device identity.',
  'Membership, recovery and sync require independent security review.',
]
export function assertCloudMode({
  diagnostic = false,
  googleTest = false,
  configuration,
}) {
  if (diagnostic) return
  check(googleTest, 'PROOF_LIVE_VAULT_SYNC_BLOCKED')
  check(configuration, 'PROOF_DEVELOPER_GOOGLE_CLIENT_REQUIRED')
  check(configuration.scope === FILE_SCOPE, 'PROOF_SCOPE_NOT_APPROVED')
}
