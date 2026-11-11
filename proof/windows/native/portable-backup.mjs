import sodium from 'libsodium-wrappers-sumo'
import { open, fromBase64 } from '../../../src/features/vault/crypto.ts'
import { profile } from './contracts.mjs'
import { check } from './errors.mjs'
import { clone, hash } from './identity.mjs'
import { resolve, sep } from 'node:path'
await sodium.ready
const MAX = 16 * 1024 * 1024
const fields = [
  'v',
  'cloudTest',
  'role',
  'identity',
  'identityEnvelope',
  'google',
  'state',
  'folders',
  'control',
  'journal',
  'uploads',
  'conflicts',
  'lastSync',
  'grantPacket',
  'wrappedHousehold',
]
const context = (id) => Buffer.from('LOCKBOX|portable-backup|1|' + id)
export function backupDestination(path, applicationDirectory) {
  const file = resolve(path),
    application = resolve(applicationDirectory)
  check(
    !file.toLowerCase().startsWith((application + sep).toLowerCase()) &&
      !/(?:^|[\\/])(?:public|dist|wwwroot|htdocs|\.git)(?:[\\/]|$)/i.test(file),
    'PROOF_BACKUP_PRIVATE_LOCATION_REQUIRED',
  )
  return file
}
export function backupHeader(packet) {
  check(
    packet &&
      Object.keys(packet).sort().join(',') ===
        'accountId,kind,payload,profile,role,v',
    'PROOF_BACKUP_INVALID',
  )
  check(
    packet.v === 1 &&
      packet.kind === 'lockbox-portable-backup' &&
      /^[a-f0-9-]{36}$/.test(packet.accountId) &&
      ['owner', 'partner'].includes(packet.role),
    'PROOF_BACKUP_INVALID',
  )
  profile(packet.profile)
  check(
    packet.payload &&
      Object.keys(packet.payload).sort().join(',') === 'ciphertext,nonce' &&
      typeof packet.payload.ciphertext === 'string' &&
      packet.payload.ciphertext.length <= Math.ceil(MAX * 1.4) &&
      typeof packet.payload.nonce === 'string',
    'PROOF_BACKUP_INVALID',
  )
  return {
    accountId: packet.accountId,
    role: packet.role,
    profile: clone(packet.profile),
  }
}
export function createPortableBackup(data, encodedRoot) {
  check(data.state.profile && data.identityEnvelope, 'PROOF_PROFILE_REQUIRED')
  const root = fromBase64(encodedRoot)
  let plain
  try {
    check(root.length === 32, 'PROOF_KEY_INVALID')
    open(
      root,
      data.state.profile.data.keyring,
      'keyring:' + data.identity.accountId,
    )
    const safe = Object.fromEntries(
      fields
        .filter((k) => data[k] !== undefined)
        .map((k) => [k, clone(data[k])]),
    )
    check(
      !safe.identity.signPrivate && !safe.identity.boxPrivate,
      'PROOF_BACKUP_INVALID',
    )
    plain = Buffer.from(JSON.stringify(safe))
    check(plain.length <= MAX - 16, 'PROOF_BACKUP_TOO_LARGE')
    const nonce = sodium.randombytes_buf(24)
    return {
      v: 1,
      kind: 'lockbox-portable-backup',
      accountId: data.identity.accountId,
      role: data.role,
      profile: clone(data.state.profile.data),
      payload: {
        nonce: Buffer.from(nonce).toString('base64'),
        ciphertext: Buffer.from(
          sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            plain,
            context(data.identity.accountId),
            null,
            nonce,
            root,
          ),
        ).toString('base64'),
      },
    }
  } finally {
    root.fill(0)
    plain?.fill(0)
  }
}
export function readPortableBackup(packet, encodedRoot, role) {
  const header = backupHeader(packet)
  check(header.role === role, 'PROOF_BACKUP_ROLE_MISMATCH')
  const root = fromBase64(encodedRoot)
  let plain
  try {
    check(root.length === 32, 'PROOF_KEY_INVALID')
    open(root, header.profile.keyring, 'keyring:' + header.accountId)
    const nonce = Buffer.from(packet.payload.nonce, 'base64'),
      cipher = Buffer.from(packet.payload.ciphertext, 'base64')
    check(
      nonce.length === 24 &&
        cipher.length >= 16 &&
        nonce.toString('base64') === packet.payload.nonce &&
        cipher.toString('base64') === packet.payload.ciphertext,
      'PROOF_BACKUP_INVALID',
    )
    plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      cipher,
      context(header.accountId),
      nonce,
      root,
    )
    const data = JSON.parse(Buffer.from(plain).toString('utf8'))
    check(
      Object.keys(data).every((k) => fields.includes(k)) &&
        data.v === 1 &&
        data.role === role &&
        data.identity?.accountId === header.accountId &&
        !data.identity.signPrivate &&
        !data.identity.boxPrivate &&
        data.identityEnvelope &&
        hash(data.state?.profile?.data) === hash(header.profile),
      'PROOF_BACKUP_INVALID',
    )
    return data
  } finally {
    root.fill(0)
    plain?.fill(0)
  }
}
