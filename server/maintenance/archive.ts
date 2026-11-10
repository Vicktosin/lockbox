import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { LoadedKeys } from '../security/key-file.ts'
import { fail } from '../errors.ts'

const format = 'lockbox-database-backup'
const maxBytes = 64 * 1024 * 1024
/** Operator backup format only. There is no vault encryption or credential API. */
export function sealBackup(snapshot: Buffer, keys: LoadedKeys): Buffer {
  if (snapshot.length > maxBytes) fail('BACKUP_SIZE_LIMIT')
  const keyVersion = keys.activeVersion
  const key = keys.keys.get(keyVersion)
  if (!key) fail('KEY_VERSION_MISSING')
  const header = { format, version: 1, keyVersion }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(JSON.stringify(header)))
  const ciphertext = Buffer.concat([cipher.update(snapshot), cipher.final()])
  return Buffer.from(
    JSON.stringify({
      ...header,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }),
  )
}
export function unsealBackup(archive: Buffer, keys: LoadedKeys): Buffer {
  if (archive.length > maxBytes * 1.4 || archive.length < 100)
    fail('BACKUP_SIZE_LIMIT')
  try {
    const item = JSON.parse(archive.toString('utf8')) as Record<string, unknown>
    if (
      Object.keys(item).sort().join(',') !==
        'ciphertext,format,iv,keyVersion,tag,version' ||
      item.format !== format ||
      item.version !== 1 ||
      typeof item.keyVersion !== 'string'
    )
      fail('BACKUP_FORMAT_INVALID')
    const key = keys.keys.get(item.keyVersion)
    if (!key) fail('KEY_VERSION_MISSING')
    const decode = (name: string) => {
      const value = item[name]
      if (typeof value !== 'string') fail('BACKUP_FORMAT_INVALID')
      const bytes = Buffer.from(value, 'base64')
      if (bytes.toString('base64') !== value) fail('BACKUP_FORMAT_INVALID')
      return bytes
    }
    const iv = decode('iv'),
      tag = decode('tag'),
      ciphertext = decode('ciphertext')
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > maxBytes)
      fail('BACKUP_FORMAT_INVALID')
    const decipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16,
    })
    decipher.setAAD(
      Buffer.from(
        JSON.stringify({ format, version: 1, keyVersion: item.keyVersion }),
      ),
    )
    decipher.setAuthTag(tag)
    // No partial plaintext is returned until final() authenticates the archive.
    const partial = decipher.update(ciphertext)
    try {
      return Buffer.concat([partial, decipher.final()])
    } finally {
      partial.fill(0)
    }
  } catch {
    fail('BACKUP_AUTHENTICATION_FAILED')
  }
}
