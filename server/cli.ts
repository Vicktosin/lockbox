import { join, dirname } from 'node:path'
import {
  issueRegistrationInvite,
  type AccountRole,
} from './auth/invitations.ts'
import { writePrivateNew } from './security/key-file.ts'
import { ensurePrivateDirectory } from './security/private-files.ts'
import { AuthError } from './auth/errors.ts'
import { randomUUID } from 'node:crypto'
import { loadFoundationConfig } from './config/foundation.ts'
import {
  initializeDatabase,
  migrateDatabase,
  openInitializedDatabase,
  pendingMigrations,
  verifySchema,
} from './database/migrations.ts'
import { openConnection } from './database/connection.ts'
import {
  initializeKeyFile,
  loadKeyFile,
  verifyDatabaseKeys,
} from './security/key-file.ts'
import { backupDatabase, restoreDatabase } from './maintenance/backups.ts'
import { createLogger } from './logging.ts'
import { FoundationError, fail } from './errors.ts'

async function main() {
  const config = loadFoundationConfig(process.env)
  const log = createLogger(config.logLevel)
  const [action, ...args] = process.argv.slice(2)
  const options = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    const name = args[i]
    if (
      !['--output', '--input', '--target', '--maintenance', '--role'].includes(
        name,
      ) ||
      options.has(name)
    )
      fail('CLI_ARGUMENT_INVALID')
    if (name === '--maintenance') options.set(name, 'true')
    else {
      const value = args[++i]
      if (!value || value.startsWith('--')) fail('CLI_ARGUMENT_INVALID')
      options.set(name, value)
    }
  }
  const allowed: Record<string, string[]> = {
    'auth:invite': ['--role', '--output'],
    'db:init': [],
    'db:check': [],
    'db:migrate': ['--maintenance'],
    'key:init': [],
    'key:check': [],
    'db:backup': ['--output'],
    'db:restore': ['--input', '--target', '--maintenance'],
  }
  if (
    !action ||
    !allowed[action] ||
    [...options.keys()].some((key) => !allowed[action].includes(key))
  )
    fail('CLI_ARGUMENT_INVALID')
  const requireOption = (key: string) => {
    const value = options.get(key)
    if (!value) fail('CLI_ARGUMENT_REQUIRED')
    return value
  }
  if (action === 'db:init') {
    initializeDatabase(config.dbPath)
    log('info', 'database.initialized')
    return
  }
  if (action === 'db:restore') {
    requireOption('--maintenance')
    restoreDatabase(
      requireOption('--input'),
      config.keyFile,
      requireOption('--target'),
    )
    log('info', 'database.restore_staged')
    return
  }
  if (action === 'db:backup') {
    await backupDatabase(
      config.dbPath,
      config.keyFile,
      requireOption('--output'),
    )
    log('info', 'database.backup_created')
    return
  }
  if (action === 'db:migrate') {
    requireOption('--maintenance')
    const db = openConnection(config.dbPath)
    try {
      verifySchema(db, undefined, true)
      if (pendingMigrations(db))
        await backupDatabase(
          config.dbPath,
          config.keyFile,
          join(config.backupDirectory, `pre-migration-${randomUUID()}.lbbak`),
          true,
        )
      const applied = migrateDatabase(db)
      log('info', 'database.migrated', { migrationVersion: applied })
    } finally {
      db.close()
    }
    return
  }
  const db = openInitializedDatabase(config.dbPath)
  try {
    if (action === 'auth:invite') {
      verifyDatabaseKeys(db, loadKeyFile(config.keyFile))
      const output = requireOption('--output')
      ensurePrivateDirectory(dirname(output))
      const invite = issueRegistrationInvite(
        db,
        requireOption('--role') as AccountRole,
      )
      try {
        writePrivateNew(output, JSON.stringify(invite) + '\n')
      } catch (error) {
        db.prepare('UPDATE account_tokens SET consumed_at=? WHERE id=?').run(
          Date.now(),
          invite.id,
        )
        throw error
      }
      log('info', 'registration.invitation_created')
    } else if (action === 'key:init') {
      initializeKeyFile(db, config.keyFile)
      log('info', 'key.initialized')
    } else if (action === 'key:check') {
      verifyDatabaseKeys(db, loadKeyFile(config.keyFile))
      log('info', 'key.verified')
    } else log('info', 'database.verified')
  } finally {
    db.close()
  }
}
main().catch((error: unknown) => {
  createLogger()('error', 'maintenance.failed', {
    code:
      error instanceof FoundationError || error instanceof AuthError
        ? error.code
        : 'FOUNDATION_OPERATION_FAILED',
  })
  process.exitCode = 1
})
