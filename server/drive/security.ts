import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import type { LoadedKeys } from '../security/key-file.ts'
export class DriveError extends Error {
  readonly code: string
  readonly temporary: boolean
  constructor(code: string, temporary = false) {
    super(code)
    this.name = 'DriveError'
    this.code = code
    this.temporary = temporary
  }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) +
          ':' +
          canonical((value as Record<string, unknown>)[key]),
      )
      .join(',') +
    '}'
  )
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex')
export const stateDigest = (state: string) =>
  createHash('sha256')
    .update('LOCKBOX-OAUTH-STATE-V1\0' + state)
    .digest('hex')
interface Sealed {
  v: 1
  keyVersion: string
  nonce: string
  ciphertext: string
  tag: string
}
export function createSealer(keys: LoadedKeys, appId: string) {
  const key = (version: string) => {
    const master = keys.keys.get(version)
    if (!master) throw new DriveError('DRIVE_KEY_UNAVAILABLE')
    const raw = master.export()
    try {
      return Buffer.from(
        hkdfSync('sha256', raw, appId, 'LOCKBOX-DRIVE-SERVER-V1', 32),
      )
    } finally {
      raw.fill(0)
    }
  }
  return {
    seal(value: unknown, context: string): string {
      const secret = key(keys.activeVersion),
        nonce = randomBytes(12),
        plain = Buffer.from(canonical(value))
      try {
        const cipher = createCipheriv('aes-256-gcm', secret, nonce)
        cipher.setAAD(Buffer.from(appId + '|' + context))
        const body = Buffer.concat([cipher.update(plain), cipher.final()])
        return JSON.stringify({
          v: 1,
          keyVersion: keys.activeVersion,
          nonce: nonce.toString('base64'),
          ciphertext: body.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
        } satisfies Sealed)
      } finally {
        secret.fill(0)
        plain.fill(0)
      }
    },
    open<T>(text: string, context: string): T {
      let secret: Buffer | undefined, plain: Buffer | undefined
      try {
        const value = JSON.parse(text) as Sealed
        if (value.v !== 1) throw new Error()
        secret = key(value.keyVersion)
        const nonce = Buffer.from(value.nonce, 'base64'),
          tag = Buffer.from(value.tag, 'base64')
        if (nonce.length !== 12 || tag.length !== 16) throw new Error()
        const cipher = createDecipheriv('aes-256-gcm', secret, nonce)
        cipher.setAAD(Buffer.from(appId + '|' + context))
        cipher.setAuthTag(tag)
        plain = Buffer.concat([
          cipher.update(Buffer.from(value.ciphertext, 'base64')),
          cipher.final(),
        ])
        return JSON.parse(plain.toString('utf8')) as T
      } catch {
        throw new DriveError('DRIVE_DATA_AUTHENTICATION_FAILED')
      } finally {
        secret?.fill(0)
        plain?.fill(0)
      }
    },
  }
}
export type Sealer = ReturnType<typeof createSealer>
export function parseFolder(link: string) {
  try {
    const url = new URL(link)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'drive.google.com' ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error()
    const match =
      /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,200})\/?$/.exec(
        url.pathname,
      )
    if (!match) throw new Error()
    const resourceKey = url.searchParams.get('resourcekey')
    if (resourceKey && !/^[A-Za-z0-9_-]{1,200}$/.test(resourceKey))
      throw new Error()
    return { id: match[1], resourceKey }
  } catch {
    throw new DriveError('DRIVE_FOLDER_LINK_INVALID')
  }
}
