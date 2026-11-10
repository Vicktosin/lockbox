import { readFileSync, rmSync, lstatSync, existsSync } from 'node:fs'
import { dirname, join, resolve, sep, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { verifySchema, migrateDatabase } from '../database/migrations.ts'
import { checkIntegrity, openConnection } from '../database/connection.ts'
import {
  assertPrivate,
  ensurePrivateDirectory,
  absolutePath,
  requireEmptyDirectory,
} from '../security/private-files.ts'
import {
  loadKeyFile,
  verifyDatabaseKeys,
  writePrivateNew,
} from '../security/key-file.ts'
import { sealBackup, unsealBackup } from './archive.ts'
import { fail } from '../errors.ts'

function cleanStage(parent: string, stage: string) {
  if (
    !resolve(stage).startsWith(resolve(parent) + sep) ||
    !stage.includes('.lockbox-stage-')
  )
    fail('STAGING_PATH_INVALID')
  rmSync(stage, { recursive: true, force: true })
}
export async function backupDatabase(
  dbPath: string,
  keyFile: string,
  output: string,
  allowPending = false,
) {
  absolutePath(output)
  const keyRelative = relative(dirname(keyFile), output)
  if (
    !keyRelative ||
    (!keyRelative.startsWith('..') && !isAbsolute(keyRelative))
  )
    fail('BACKUP_PATH_INVALID')
  if (
    resolve(output) === resolve(dbPath) ||
    resolve(output) === resolve(keyFile) ||
    dirname(output) === dirname(keyFile)
  )
    fail('BACKUP_PATH_INVALID')
  if (existsSync(output)) fail('BACKUP_ALREADY_EXISTS')
  ensurePrivateDirectory(dirname(output))
  const keys = loadKeyFile(keyFile)
  const stage = join(dirname(output), '.lockbox-stage-' + randomUUID())
  ensurePrivateDirectory(stage)
  let db: ReturnType<typeof openConnection> | undefined
  try {
    db = openConnection(dbPath)
    verifySchema(db, undefined, allowPending)
    verifyDatabaseKeys(db, keys)
    const snapshot = join(stage, 'snapshot.sqlite')
    await db.backup(snapshot)
    // All staging directories are already private. Snapshot is never returned raw.
    const check = openConnection(snapshot)
    try {
      verifySchema(check, undefined, allowPending)
      verifyDatabaseKeys(check, keys)
    } finally {
      check.close()
    }
    if (lstatSync(snapshot).size > 64 * 1024 * 1024) fail('BACKUP_SIZE_LIMIT')
    const contents = readFileSync(snapshot)
    try {
      writePrivateNew(output, sealBackup(contents, keys))
    } finally {
      contents.fill(0)
    }
  } finally {
    db?.close()
    cleanStage(dirname(output), stage)
  }
}
export function restoreDatabase(
  archivePath: string,
  keyFile: string,
  target: string,
) {
  absolutePath(target)
  assertPrivate(archivePath, 'file')
  if (lstatSync(archivePath).size > 90 * 1024 * 1024) fail('BACKUP_SIZE_LIMIT')
  const keys = loadKeyFile(keyFile)
  const contents = unsealBackup(readFileSync(archivePath), keys)
  // Never overwrite/rename a live database. Restore produces an isolated validated copy.
  let written = false
  try {
    requireEmptyDirectory(dirname(target))
    writePrivateNew(target, contents)
    written = true
    const db = openConnection(target)
    try {
      verifySchema(db, undefined, true)
      verifyDatabaseKeys(db, keys)
      migrateDatabase(db)
      checkIntegrity(db)
      db.transaction(() => {
        db.prepare('DELETE FROM sessions').run()
        db.prepare('DELETE FROM account_tokens').run()
        db.prepare('DELETE FROM drive_oauth_states').run()
        db.prepare('DELETE FROM drive_connection').run()
        db.prepare('DELETE FROM drive_checkpoints').run()
        db.prepare('DELETE FROM drive_objects').run()
        db.prepare('DELETE FROM drive_commit_cache').run()
        db.prepare('DELETE FROM drive_conflicts').run()
        db.prepare(
          'UPDATE users SET password_reset_required=1,recovery_email_verified_at=NULL',
        ).run()
      }).immediate()
      db.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
  } catch (error) {
    if (written)
      for (const file of [target, target + '-wal', target + '-shm'])
        if (existsSync(file)) rmSync(file)
    throw error
  } finally {
    contents.fill(0)
  }
}
