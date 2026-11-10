import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { openConnection } from './connection.ts'
import {
  migrateDatabase,
  pendingMigrations,
  verifySchema,
} from './migrations.ts'
import { backupDatabase } from '../maintenance/backups.ts'
/** Deployment startup upgrade: existing database/key required, encrypted backup before changes. */
export async function upgradeExistingDatabase(config: {
  dbPath: string
  keyFile: string
  backupDirectory: string
}) {
  const db = openConnection(config.dbPath)
  try {
    verifySchema(db, undefined, true)
    if (pendingMigrations(db)) {
      await backupDatabase(
        config.dbPath,
        config.keyFile,
        join(config.backupDirectory, 'pre-startup-' + randomUUID() + '.lbbak'),
        true,
      )
      migrateDatabase(db)
    }
  } finally {
    db.close()
  }
}
