import {
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
  lstatSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  randomBytes,
  createSecretKey,
  createHmac,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto'
import type { Sqlite } from '../database/connection.ts'
import {
  assertPrivate,
  ensurePrivateDirectory,
  absolutePath,
  rejectLinks,
} from './private-files.ts'
import { fail } from '../errors.ts'

export interface LoadedKeys {
  activeVersion: string
  keys: ReadonlyMap<string, KeyObject>
}
export function writePrivateNew(path: string, data: string | Uint8Array) {
  absolutePath(path)
  rejectLinks(path)
  ensurePrivateDirectory(dirname(path))
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  assertPrivate(path, 'file')
}
export function loadKeyFile(path: string): LoadedKeys {
  try {
    assertPrivate(path, 'file')
    if (lstatSync(path).size > 16384) fail('KEY_FILE_INVALID')
    const value = JSON.parse(readFileSync(path, 'utf8')) as {
      format?: unknown
      activeVersion?: unknown
      keys?: unknown
    }
    if (
      value.format !== 'lockbox-server-keys-v1' ||
      typeof value.activeVersion !== 'string' ||
      !value.keys ||
      typeof value.keys !== 'object' ||
      Array.isArray(value.keys)
    )
      fail('KEY_FILE_INVALID')
    const keys = new Map<string, KeyObject>()
    const entries = Object.entries(value.keys)
    if (entries.length < 1 || entries.length > 16) fail('KEY_FILE_INVALID')
    for (const [version, encoded] of entries) {
      if (!/^v[1-9][0-9]{0,5}$/.test(version) || typeof encoded !== 'string')
        fail('KEY_FILE_INVALID')
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.length !== 32 || bytes.toString('base64') !== encoded)
        fail('KEY_FILE_INVALID')
      keys.set(version, createSecretKey(bytes))
      bytes.fill(0)
    }
    if (!keys.has(value.activeVersion)) fail('KEY_FILE_INVALID')
    return { activeVersion: value.activeVersion, keys }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      fail('KEY_FILE_MISSING')
    throw error
  }
}
function checkValue(db: Sqlite, version: string, key: KeyObject) {
  const row = db
    .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
    .get() as { value: string } | undefined
  if (!row) fail('DATABASE_ID_MISSING')
  return createHmac('sha256', key)
    .update('LOCKBOX-DATABASE-KEY-CHECK-V1\0')
    .update(row.value)
    .update('\0')
    .update(version)
    .digest()
}
export function verifyDatabaseKeys(db: Sqlite, loaded: LoadedKeys) {
  const rows = db
    .prepare('SELECT key_version,check_value FROM encryption_key_checks')
    .all() as { key_version: string; check_value: Buffer }[]
  if (!rows.length) fail('DATABASE_KEY_NOT_INITIALIZED')
  for (const row of rows) {
    const key = loaded.keys.get(row.key_version)
    if (!key) fail('KEY_VERSION_MISSING')
    if (!timingSafeEqual(row.check_value, checkValue(db, row.key_version, key)))
      fail('KEY_DATABASE_MISMATCH')
  }
  if (!rows.some((row) => row.key_version === loaded.activeVersion))
    fail('ACTIVE_KEY_NOT_REGISTERED')
}
export function initializeKeyFile(db: Sqlite, path: string) {
  let loaded: LoadedKeys
  let created = false
  try {
    loaded = loadKeyFile(path)
  } catch (error) {
    if ((error as { code?: string }).code !== 'KEY_FILE_MISSING') throw error
    if (
      (
        db.prepare('SELECT count(*) AS n FROM encryption_key_checks').get() as {
          n: number
        }
      ).n
    )
      fail('KEY_FILE_MISSING')
    const bytes = randomBytes(32)
    const contents =
      JSON.stringify({
        format: 'lockbox-server-keys-v1',
        activeVersion: 'v1',
        keys: { v1: bytes.toString('base64') },
      }) + '\n'
    bytes.fill(0)
    writePrivateNew(path, contents)
    loaded = loadKeyFile(path)
    created = true
  }
  const register = db.transaction(() => {
    const count = (
      db.prepare('SELECT count(*) AS n FROM encryption_key_checks').get() as {
        n: number
      }
    ).n
    if (count) {
      verifyDatabaseKeys(db, loaded)
      return
    }
    // Explicit initialization only. A nonempty payload table is never rebound.
    if (
      (
        db.prepare('SELECT count(*) AS n FROM encrypted_payloads').get() as {
          n: number
        }
      ).n
    )
      fail('KEY_INITIALIZATION_UNSAFE')
    for (const [version, key] of loaded.keys)
      db.prepare(
        'INSERT INTO encryption_key_checks(key_version,check_value) VALUES(?,?)',
      ).run(version, checkValue(db, version, key))
  })
  register.immediate()
  verifyDatabaseKeys(db, loaded)
  return { created }
}
