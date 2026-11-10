import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import type { Sqlite } from './connection.ts'
import { openConnection, checkIntegrity } from './connection.ts'
import { fail } from '../errors.ts'

export const defaultMigrationDirectory = fileURLToPath(
  new URL('./migrations', import.meta.url),
)
interface Migration {
  version: number
  name: string
  checksum: string
  sql: string
}
function migrations(directory: string): Migration[] {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const result = files.map((name, index) => {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name)
    if (!match || Number(match[1]) !== index + 1)
      fail('MIGRATION_ORDER_INVALID')
    const sql = readFileSync(join(directory, name), 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
    return {
      version: index + 1,
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    }
  })
  if (!result.length) fail('MIGRATION_FILES_MISSING')
  return result
}
interface Applied {
  version: number
  name: string
  checksum: string
}
function history(db: Sqlite, expected: Migration[], allowMissing: boolean) {
  const tracked = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get()
  if (!tracked) {
    if (allowMissing) return []
    fail('DATABASE_NOT_INITIALIZED')
  }
  const applied = db
    .prepare(
      'SELECT version,name,checksum FROM schema_migrations ORDER BY version',
    )
    .all() as Applied[]
  applied.forEach((row, index) => {
    if (row.version !== index + 1 || !expected[index])
      fail('MIGRATION_HISTORY_INVALID')
    if (
      row.name !== expected[index].name ||
      row.checksum !== expected[index].checksum
    )
      fail('MIGRATION_CHECKSUM_MISMATCH')
  })
  return applied
}
export function verifySchema(
  db: Sqlite,
  directory = defaultMigrationDirectory,
  allowPending = false,
) {
  const expected = migrations(directory)
  if (!allowPending && history(db, expected, false).length !== expected.length)
    fail('MIGRATION_REQUIRED')
  history(db, expected, false)
  if (
    !db.prepare("SELECT value FROM app_metadata WHERE name='database_id'").get()
  )
    fail('DATABASE_ID_MISSING')
  checkIntegrity(db)
}
export function migrateDatabase(
  db: Sqlite,
  directory = defaultMigrationDirectory,
) {
  const expected = migrations(directory)
  const apply = db.transaction(() => {
    const applied = history(db, expected, true)
    if (
      !db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='schema_migrations'",
        )
        .get()
    ) {
      if (
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .get() as { n: number }
        ).n
      )
        fail('UNTRACKED_DATABASE')
      db.exec(
        'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL CHECK(length(checksum)=64), applied_at INTEGER NOT NULL) STRICT',
      )
    }
    for (const migration of expected.slice(applied.length)) {
      db.exec(migration.sql)
      db.prepare(
        'INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?,?,?,?)',
      ).run(migration.version, migration.name, migration.checksum, Date.now())
    }
    db.prepare(
      "INSERT OR IGNORE INTO app_metadata(name,value) VALUES('database_id',?)",
    ).run(randomUUID())
    checkIntegrity(db)
    return expected.length - applied.length
  })
  const count = apply.exclusive()
  verifySchema(db, directory)
  return count
}
export function initializeDatabase(
  path: string,
  directory = defaultMigrationDirectory,
) {
  const existed = existsSync(path)
  const db = openConnection(path, true)
  try {
    // Repeated initialization validates only; upgrades are explicit migration operations.
    if (existed) {
      verifySchema(db, directory)
      return { created: false, applied: 0 }
    }
    return { created: true, applied: migrateDatabase(db, directory) }
  } finally {
    db.close()
  }
}
export function openInitializedDatabase(
  path: string,
  directory = defaultMigrationDirectory,
) {
  const db = openConnection(path)
  try {
    verifySchema(db, directory)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function pendingMigrations(db: Sqlite) {
  const expected = migrations(defaultMigrationDirectory)
  return expected.length - history(db, expected, false).length
}
