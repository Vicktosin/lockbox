import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToHex, hexToBytes, equalBytes } from '@noble/ciphers/utils.js'
import { deriveMasterKey, validMasterPassword } from './kdf.ts'
import type { Envelope, VaultProfile } from '../../../shared/client-vault.ts'
export type { Envelope, VaultProfile }
const encode = new TextEncoder(),
  decode = new TextDecoder('utf-8', { fatal: true })
export const randomKey = () => crypto.getRandomValues(new Uint8Array(32))
export const toBase64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
export function fromBase64(value: string) {
  if (typeof value !== 'string' || value.length > 900000)
    throw new Error('Unsupported encrypted data.')
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  if (toBase64(bytes) !== value) throw new Error('Unsupported encrypted data.')
  return bytes
}
export function seal(
  key: Uint8Array,
  value: unknown,
  context: string,
): Envelope {
  const nonce = crypto.getRandomValues(new Uint8Array(24)),
    plain = encode.encode(JSON.stringify(value))
  if (plain.length > 500000) {
    plain.fill(0)
    throw new Error('Vault is too large for this local version.')
  }
  try {
    return {
      v: 1,
      alg: 'XChaCha20-Poly1305',
      nonce: toBase64(nonce),
      ciphertext: toBase64(
        xchacha20poly1305(
          key,
          nonce,
          encode.encode('LOCKBOX|1|' + context),
        ).encrypt(plain),
      ),
    }
  } finally {
    plain.fill(0)
  }
}
export function open<T>(
  key: Uint8Array,
  envelope: Envelope,
  context: string,
): T {
  if (envelope.v !== 1 || envelope.alg !== 'XChaCha20-Poly1305')
    throw new Error('Unsupported encryption format.')
  const nonce = fromBase64(envelope.nonce),
    cipher = fromBase64(envelope.ciphertext)
  if (nonce.length !== 24 || cipher.length < 16)
    throw new Error('Invalid encrypted data.')
  let plain: Uint8Array | undefined
  try {
    plain = xchacha20poly1305(
      key,
      nonce,
      encode.encode('LOCKBOX|1|' + context),
    ).decrypt(cipher)
    return JSON.parse(decode.decode(plain)) as T
  } finally {
    plain?.fill(0)
  }
}
async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  if (!validMasterPassword(password))
    throw new Error('Use a master passphrase of 15–128 characters.')
  if (typeof Worker === 'undefined') return deriveMasterKey(password, salt)
  const worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), {
    type: 'module',
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('Key derivation timed out.'))
    }, 60000)
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    worker.onmessage = (event: MessageEvent<{ key?: Uint8Array }>) => {
      finish()
      if (event.data.key?.length === 32) resolve(event.data.key)
      else reject(new Error('Unable to derive vault key.'))
    }
    worker.onerror = () => {
      finish()
      reject(new Error('Unable to derive vault key.'))
    }
    worker.postMessage({ password, salt })
  })
}
export interface Keyring {
  v: 1
  personal: string
  household: { id: string; key: string } | null
}
export interface UnlockedKeys {
  root: Uint8Array
  personal: Uint8Array
  household: { id: string; key: Uint8Array } | null
}
export function destroyKeys(keys: UnlockedKeys) {
  keys.root.fill(0)
  keys.personal.fill(0)
  keys.household?.key.fill(0)
}
export function wrapKeyring(keys: UnlockedKeys, userId: string) {
  return seal(
    keys.root,
    {
      v: 1,
      personal: toBase64(keys.personal),
      household: keys.household
        ? { id: keys.household.id, key: toBase64(keys.household.key) }
        : null,
    } satisfies Keyring,
    'keyring:' + userId,
  )
}
function readKeys(
  root: Uint8Array,
  profile: VaultProfile,
  userId: string,
): UnlockedKeys {
  try {
    const ring = open<Keyring>(root, profile.keyring, 'keyring:' + userId)
    if (ring.v !== 1) throw new Error()
    const personal = fromBase64(ring.personal)
    const household = ring.household
      ? { id: ring.household.id, key: fromBase64(ring.household.key) }
      : null
    if (
      personal.length !== 32 ||
      (household && (household.key.length !== 32 || !validId(household.id)))
    ) {
      personal.fill(0)
      household?.key.fill(0)
      throw new Error()
    }
    return { root, personal, household }
  } catch {
    root.fill(0)
    throw new Error('Vault key authentication failed.')
  }
}
const rootContext = (userId: string, profile: VaultProfile) =>
  'master:' + userId + ':' + profile.kdf.salt
function checkProfile(profile: VaultProfile) {
  const kdf = profile.kdf
  if (
    profile.v !== 1 ||
    kdf.name !== 'Argon2id' ||
    kdf.memory !== 65536 ||
    kdf.iterations !== 3 ||
    kdf.parallelism !== 1 ||
    fromBase64(kdf.salt).length !== 16
  )
    throw new Error('Unsupported vault key format.')
}
function readRoot(key: Uint8Array, envelope: Envelope, context: string) {
  const data = open<{ v: number; root: string }>(key, envelope, context)
  const root = fromBase64(data.root)
  if (data.v !== 1 || root.length !== 32) {
    root.fill(0)
    throw new Error('Invalid vault key.')
  }
  return root
}
export function recoveryCode() {
  const key = randomKey()
  try {
    return bytesToHex(key).match(/.{8}/g)!.join('-')
  } finally {
    key.fill(0)
  }
}
function recoveryBytes(code: string) {
  const normalized = code.replace(/[ -]/g, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized))
    throw new Error('Enter the complete 256-bit recovery key.')
  return hexToBytes(normalized)
}
export async function createProfile(
  userId: string,
  password: string,
  confirmation: string,
) {
  if (password !== confirmation)
    throw new Error('Master passwords do not match.')
  const keys: UnlockedKeys = {
    root: randomKey(),
    personal: randomKey(),
    household: null,
  }
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    code = recoveryCode()
  const profile = {
    v: 1,
    kdf: {
      name: 'Argon2id',
      memory: 65536,
      iterations: 3,
      parallelism: 1,
      salt: toBase64(salt),
    },
  } as VaultProfile
  let master: Uint8Array | undefined, recovery: Uint8Array | undefined
  try {
    master = await derive(password, salt)
    recovery = recoveryBytes(code)
    profile.master = seal(
      master,
      { v: 1, root: toBase64(keys.root) },
      rootContext(userId, profile),
    )
    profile.recovery = seal(
      recovery,
      { v: 1, root: toBase64(keys.root) },
      'recovery:' + userId,
    )
    profile.keyring = wrapKeyring(keys, userId)
    return { keys, profile, recoveryCode: code }
  } catch (error) {
    destroyKeys(keys)
    throw error
  } finally {
    master?.fill(0)
    recovery?.fill(0)
  }
}
export async function unlockProfile(
  userId: string,
  profile: VaultProfile,
  password: string,
) {
  checkProfile(profile)
  let master: Uint8Array | undefined
  try {
    master = await derive(password, fromBase64(profile.kdf.salt))
    return readKeys(
      readRoot(master, profile.master, rootContext(userId, profile)),
      profile,
      userId,
    )
  } catch {
    throw new Error('Incorrect master password or damaged vault keys.')
  } finally {
    master?.fill(0)
  }
}
export function recoverProfile(
  userId: string,
  profile: VaultProfile,
  code: string,
) {
  checkProfile(profile)
  const key = recoveryBytes(code)
  try {
    return readKeys(
      readRoot(key, profile.recovery, 'recovery:' + userId),
      profile,
      userId,
    )
  } catch {
    throw new Error('Incorrect recovery key or damaged vault keys.')
  } finally {
    key.fill(0)
  }
}
export function verifyRecovery(
  userId: string,
  profile: VaultProfile,
  code: string,
  root: Uint8Array,
) {
  const keys = recoverProfile(userId, profile, code)
  try {
    if (!equalBytes(keys.root, root))
      throw new Error('Recovery verification failed.')
  } finally {
    destroyKeys(keys)
  }
}
export async function rewrapMaster(
  userId: string,
  profile: VaultProfile,
  keys: UnlockedKeys,
  password: string,
  confirmation: string,
) {
  if (password !== confirmation)
    throw new Error('Master passwords do not match.')
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    next = { ...profile, kdf: { ...profile.kdf, salt: toBase64(salt) } }
  const master = await derive(password, salt)
  try {
    return {
      ...next,
      master: seal(
        master,
        { v: 1, root: toBase64(keys.root) },
        rootContext(userId, next),
      ),
    }
  } finally {
    master.fill(0)
  }
}
export function rotateRecovery(
  userId: string,
  profile: VaultProfile,
  keys: UnlockedKeys,
) {
  const code = recoveryCode(),
    key = recoveryBytes(code)
  try {
    return {
      recoveryCode: code,
      profile: {
        ...profile,
        recovery: seal(
          key,
          { v: 1, root: toBase64(keys.root) },
          'recovery:' + userId,
        ),
      },
    }
  } finally {
    key.fill(0)
  }
}
export const validId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  )
export const householdCode = (id: string, key: Uint8Array) =>
  'LBH1.' + id + '.' + bytesToHex(key)
export function parseHouseholdCode(code: string) {
  const parts = code.trim().split('.')
  if (
    parts.length !== 3 ||
    parts[0] !== 'LBH1' ||
    !validId(parts[1]) ||
    !/^[a-fA-F0-9]{64}$/.test(parts[2])
  )
    throw new Error('Enter the complete household key.')
  return { id: parts[1], key: hexToBytes(parts[2]) }
}
