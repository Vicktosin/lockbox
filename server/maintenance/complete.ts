import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
} from 'node:fs'
import { join, dirname, resolve, sep, relative, isAbsolute } from 'node:path'
import {
  createHash,
  createSecretKey,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import type { LoadedKeys } from '../security/key-file.ts'
import {
  loadKeyFile,
  verifyDatabaseKeys,
  writePrivateNew,
} from '../security/key-file.ts'
import {
  assertPrivate,
  ensurePrivateDirectory,
  requireEmptyDirectory,
} from '../security/private-files.ts'
import { openConnection } from '../database/connection.ts'
import { checkIntegrity } from '../database/connection.ts'
import { migrateDatabase, verifySchema } from '../database/migrations.ts'
import { sealBackup, unsealBackup } from './archive.ts'
import { fail } from '../errors.ts'

export interface CompleteConfig {
  dbPath: string
  keyFile: string
  backupDirectory: string
  origin: string
}
export interface DeploymentSecrets {
  googleClientId?: string
  googleClientSecret?: string
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
export function emergencyKeyPath(config: CompleteConfig) {
  return join(dirname(dirname(config.keyFile)), 'recovery', 'disaster.key')
}
export function loadEmergencyKey(path: string): LoadedKeys {
  assertPrivate(path, 'file')
  const text = readFileSync(path, 'utf8').trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) fail('RECOVERY_KEY_INVALID')
  const bytes = Buffer.from(text, 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== text)
    fail('RECOVERY_KEY_INVALID')
  try {
    return {
      activeVersion: 'v1',
      keys: new Map([['v1', createSecretKey(bytes)]]),
    }
  } finally {
    bytes.fill(0)
  }
}
export function initializeEmergencyKey(
  config: CompleteConfig,
  existingRemote = false,
) {
  const path = emergencyKeyPath(config)
  const location = relative(config.backupDirectory, path)
  if (!location || (!location.startsWith('..') && !isAbsolute(location)))
    fail('RECOVERY_KEY_OVERLAP')
  if (existingRemote && !existsSync(path)) fail('RECOVERY_KEY_MISSING')
  ensurePrivateDirectory(config.backupDirectory)
  if (!existsSync(path)) {
    if (
      readdirSync(config.backupDirectory).some((x) => x.startsWith('complete-'))
    )
      fail('RECOVERY_KEY_MISSING')
    writePrivateNew(path, randomBytes(32).toString('base64url') + '\n')
  }
  loadEmergencyKey(path)
  return path
}
interface Bundle {
  format: 'lockbox-complete-v1'
  createdAt: number
  database: string
  databaseHash: string
  serverKeys: string
  serverKeysHash: string
  deployment: {
    origin: string
    googleClientId?: string
    googleClientSecret?: string
  }
}
function cleanup(parent: string, stage: string) {
  if (
    !resolve(stage).startsWith(resolve(parent) + sep) ||
    !dirname(stage).includes(resolve(parent)) ||
    !stage.includes('.complete-stage-')
  )
    fail('STAGING_PATH_INVALID')
  rmSync(stage, { recursive: true, force: true })
}
function restoreContents(
  contents: Buffer,
  target: string,
  expectedDatabaseId?: string,
) {
  const bundle = JSON.parse(contents.toString('utf8')) as Bundle
  if (
    bundle.format !== 'lockbox-complete-v1' ||
    typeof bundle.database !== 'string' ||
    typeof bundle.serverKeys !== 'string' ||
    !Number.isSafeInteger(bundle.createdAt) ||
    typeof bundle.deployment?.origin !== 'string'
  )
    fail('BACKUP_FORMAT_INVALID')
  const origin = new URL(bundle.deployment.origin)
  if (
    origin.origin !== bundle.deployment.origin ||
    !['https:', 'http:'].includes(origin.protocol)
  )
    fail('BACKUP_FORMAT_INVALID')
  const database = Buffer.from(bundle.database, 'base64'),
    keys = Buffer.from(bundle.serverKeys, 'base64')
  try {
    if (
      database.length > 48 * 1024 * 1024 ||
      keys.length > 16384 ||
      hash(database) !== bundle.databaseHash ||
      hash(keys) !== bundle.serverKeysHash
    )
      fail('BACKUP_AUTHENTICATION_FAILED')
    requireEmptyDirectory(target)
    const dbPath = join(target, 'db', 'lockbox.sqlite'),
      keyFile = join(target, 'keys', 'application-key.json')
    writePrivateNew(keyFile, keys)
    writePrivateNew(dbPath, database)
    const loaded = loadKeyFile(keyFile),
      db = openConnection(dbPath)
    try {
      verifySchema(db, undefined, true)
      verifyDatabaseKeys(db, loaded)
      if (
        expectedDatabaseId &&
        (
          db
            .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
            .get() as { value: string }
        ).value !== expectedDatabaseId
      )
        fail('BACKUP_WRONG_DATABASE')
      migrateDatabase(db)
      checkIntegrity(db)
      if (
        db
          .prepare(
            'SELECT 1 FROM users u WHERE active=1 AND NOT EXISTS(SELECT 1 FROM login_recovery r WHERE r.user_id=u.id AND r.consumed_at IS NULL) LIMIT 1',
          )
          .get()
      )
        fail('BACKUP_RECOVERY_CODES_REQUIRED')
      db.transaction(() => {
        db.prepare('DELETE FROM sessions').run()
        db.prepare('DELETE FROM account_tokens').run()
        db.prepare('DELETE FROM drive_oauth_states').run()
        // Keep folder/checkpoints/conflicts/history, never resurrect an old Google grant.
        db.prepare(
          "UPDATE drive_connection SET tokens=NULL,status='reauth-required',epoch=?,lease_owner=NULL,lease_until=NULL,retry_at=NULL,last_error='DRIVE_RECONNECT_AFTER_RESTORE'",
        ).run(randomUUID())
        db.prepare(
          'UPDATE users SET password_reset_required=1,recovery_email_verified_at=NULL',
        ).run()
        db.prepare(
          "INSERT INTO app_metadata(name,value) VALUES('complete_restore',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
        ).run(
          JSON.stringify({
            verifiedAt: Date.now(),
            sourceCreatedAt: bundle.createdAt,
          }),
        )
      }).immediate()
      db.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
    writePrivateNew(
      join(target, 'deployment.json'),
      JSON.stringify({
        format: 'lockbox-restored-deployment-v1',
        ...bundle.deployment,
        dbPath,
        keyFile,
        backupDirectory: join(target, 'backups'),
      }),
    )
    writePrivateNew(
      join(target, 'restore-status.json'),
      JSON.stringify({
        verifiedAt: Date.now(),
        sourceCreatedAt: bundle.createdAt,
        googleReconnectionRequired: true,
        loginRecoveryRequired: true,
      }),
    )
    return { dbPath, keyFile, sourceCreatedAt: bundle.createdAt }
  } finally {
    database.fill(0)
    keys.fill(0)
  }
}
export function restoreComplete(
  archive: string,
  emergencyFile: string,
  target: string,
  expectedDatabaseId?: string,
) {
  assertPrivate(archive, 'file')
  if (lstatSync(archive).size > 90 * 1024 * 1024) fail('BACKUP_SIZE_LIMIT')
  // No overwrite, including failure cases. Incomplete output remains quarantined for operator inspection.
  requireEmptyDirectory(target)
  const contents = unsealBackup(
    readFileSync(archive),
    loadEmergencyKey(emergencyFile),
  )
  try {
    const restored = restoreContents(contents, target, expectedDatabaseId)
    writePrivateNew(
      join(target, 'recovery', 'disaster.key'),
      readFileSync(emergencyFile),
    )
    return restored
  } finally {
    contents.fill(0)
  }
}
export async function createComplete(
  config: CompleteConfig,
  secrets: DeploymentSecrets = {},
  now = Date.now,
  existingRemote = false,
) {
  const emergency = initializeEmergencyKey(config, existingRemote),
    keys = loadKeyFile(config.keyFile),
    id = randomUUID(),
    stage = join(config.backupDirectory, '.complete-stage-' + id)
  ensurePrivateDirectory(stage)
  const db = openConnection(config.dbPath)
  try {
    verifySchema(db)
    verifyDatabaseKeys(db, keys)
    if (
      db
        .prepare(
          'SELECT 1 FROM users u WHERE active=1 AND NOT EXISTS(SELECT 1 FROM login_recovery r WHERE r.user_id=u.id AND r.consumed_at IS NULL) LIMIT 1',
        )
        .get()
    )
      fail('BACKUP_RECOVERY_CODES_REQUIRED')
    const snapshot = join(stage, 'snapshot.sqlite')
    await db.backup(snapshot)
    if (lstatSync(snapshot).size > 48 * 1024 * 1024) fail('BACKUP_SIZE_LIMIT')
    const database = readFileSync(snapshot),
      serverKeys = readFileSync(config.keyFile)
    let contents: Buffer | undefined
    try {
      contents = Buffer.from(
        JSON.stringify({
          format: 'lockbox-complete-v1',
          createdAt: now(),
          database: database.toString('base64'),
          databaseHash: hash(database),
          serverKeys: serverKeys.toString('base64'),
          serverKeysHash: hash(serverKeys),
          deployment: { origin: config.origin, ...secrets },
        } satisfies Bundle),
      )
      const encrypted = sealBackup(contents, loadEmergencyKey(emergency))
      // Actual clean restore from the encrypted bytes, not merely an encryption round trip.
      const decoded = unsealBackup(encrypted, loadEmergencyKey(emergency))
      try {
        restoreContents(decoded, join(stage, 'verification'))
      } finally {
        decoded.fill(0)
      }
      const filename = 'complete-' + now() + '-' + id + '.lbx'
      const output = join(config.backupDirectory, filename)
      writePrivateNew(output, encrypted)
      const verified = unsealBackup(
        readFileSync(output),
        loadEmergencyKey(emergency),
      )
      try {
        if (hash(verified) !== hash(contents))
          fail('BACKUP_AUTHENTICATION_FAILED')
      } finally {
        verified.fill(0)
      }
      return { filename, createdAt: now(), verifiedAt: now() }
    } finally {
      database.fill(0)
      serverKeys.fill(0)
      contents?.fill(0)
    }
  } finally {
    db.close()
    cleanup(config.backupDirectory, stage)
  }
}
/** Authenticate and restore remote bytes before reading archived ciphertext; no live state is modified. */
export function inspectComplete<T>(
  encrypted: Buffer,
  keyFile: string,
  parent: string,
  read: (db: ReturnType<typeof openConnection>) => T,
): T {
  ensurePrivateDirectory(parent)
  const stage = join(parent, '.complete-stage-' + randomUUID())
  ensurePrivateDirectory(stage)
  let contents: Buffer | undefined
  try {
    contents = unsealBackup(encrypted, loadEmergencyKey(keyFile))
    const restored = restoreContents(contents, join(stage, 'restored')),
      db = openConnection(restored.dbPath)
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    contents?.fill(0)
    cleanup(parent, stage)
  }
}
