import { readFileSync, lstatSync } from 'node:fs'
import { assertPrivate } from '../security/private-files.ts'
import { fail } from '../errors.ts'
// Maintainer-only restored configuration. Never served to the frontend.
export function loadRestoredDeployment(
  env: Record<string, string | undefined>,
) {
  if (!env.LOCKBOX_DEPLOYMENT_FILE) return env
  assertPrivate(env.LOCKBOX_DEPLOYMENT_FILE, 'file')
  if (lstatSync(env.LOCKBOX_DEPLOYMENT_FILE).size > 32768)
    fail('CONFIG_RESTORE_INVALID')
  const item = JSON.parse(
    readFileSync(env.LOCKBOX_DEPLOYMENT_FILE, 'utf8'),
  ) as Record<string, unknown>
  if (item.format !== 'lockbox-restored-deployment-v1')
    fail('CONFIG_RESTORE_INVALID')
  const result = { ...env }
  const fields = {
    dbPath: 'LOCKBOX_DB_PATH',
    keyFile: 'LOCKBOX_KEY_FILE',
    backupDirectory: 'LOCKBOX_BACKUP_DIR',
    origin: 'LOCKBOX_APP_ORIGIN',
    googleClientId: 'LOCKBOX_GOOGLE_CLIENT_ID',
    googleClientSecret: 'LOCKBOX_GOOGLE_CLIENT_SECRET',
  }
  for (const [key, name] of Object.entries(fields))
    if (item[key] !== undefined) {
      if (typeof item[key] !== 'string') fail('CONFIG_RESTORE_INVALID')
      result[name] = item[key]
    }
  return result
}
