import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { lstatSync, existsSync, chmodSync } from 'node:fs'
import {
  assertPrivate,
  ensurePrivateDirectory,
  absolutePath,
  rejectLinks,
} from '../security/private-files.ts'
import { fail } from '../errors.ts'

export type Sqlite = Database.Database
export function openConnection(path: string, create = false): Sqlite {
  absolutePath(path)
  rejectLinks(path)
  if (create) ensurePrivateDirectory(dirname(path))
  else if (!existsSync(path)) fail('DATABASE_MISSING')
  assertPrivate(dirname(path), 'directory')
  if (existsSync(path)) {
    if (!lstatSync(path).isFile()) fail('DATABASE_PATH_INVALID')
    assertPrivate(path, 'file')
  }
  const db = new Database(path, { fileMustExist: !create, timeout: 5000 })
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('busy_timeout = 5000')
    if (
      db.pragma('foreign_keys', { simple: true }) !== 1 ||
      db.pragma('journal_mode', { simple: true }) !== 'wal' ||
      db.pragma('synchronous', { simple: true }) !== 2 ||
      db.pragma('busy_timeout', { simple: true }) !== 5000
    )
      fail('DATABASE_SETTINGS_INVALID')
    // SQLite creates files within an already private directory; restrict Unix file mode too.
    if (process.platform !== 'win32') {
      for (const file of [path, path + '-wal', path + '-shm'])
        if (existsSync(file)) chmodSync(file, 0o600)
    }
    assertPrivate(path, 'file')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
export function checkIntegrity(db: Sqlite) {
  if (
    db.pragma('integrity_check', { simple: true }) !== 'ok' ||
    (db.pragma('foreign_key_check') as unknown[]).length
  )
    fail('DATABASE_INTEGRITY_FAILED')
}
