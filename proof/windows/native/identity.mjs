import sodium from 'libsodium-wrappers-sumo'
import { createHash, randomUUID } from 'node:crypto'
import { check } from './errors.mjs'
await sodium.ready
export const clone = (value) => structuredClone(value)
export const encode = (bytes) => Buffer.from(bytes).toString('base64')
export const decode = (value) => {
  check(typeof value === 'string' && value.length < 1500000)
  const bytes = Buffer.from(value, 'base64')
  check(bytes.toString('base64') === value)
  return bytes
}
export const canonical = (value) =>
  JSON.stringify(
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map((v) => JSON.parse(canonical(v)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, JSON.parse(canonical(value[k]))]),
          )
      : value,
  )
export const hash = (value) =>
  createHash('sha256').update(canonical(value)).digest('hex')
export function newIdentity() {
  const sign = sodium.crypto_sign_keypair(),
    box = sodium.crypto_box_keypair()
  return {
    accountId: randomUUID(),
    deviceId: randomUUID(),
    signPublic: encode(sign.publicKey),
    signPrivate: encode(sign.privateKey),
    boxPublic: encode(box.publicKey),
    boxPrivate: encode(box.privateKey),
  }
}
export const publicIdentity = (identity) => ({
  accountId: identity.accountId,
  deviceId: identity.deviceId,
  signPublic: identity.signPublic,
  boxPublic: identity.boxPublic,
})
export function signed(identity, body) {
  return {
    body,
    signature: encode(
      sodium.crypto_sign_detached(
        canonical(body),
        decode(identity.signPrivate),
      ),
    ),
  }
}
export function verify(packet, key) {
  check(
    packet &&
      typeof packet === 'object' &&
      Object.keys(packet).sort().join(',') === 'body,signature',
    'PROOF_SIGNATURE_INVALID',
  )
  check(
    sodium.crypto_sign_verify_detached(
      decode(packet.signature),
      canonical(packet.body),
      decode(key),
    ),
    'PROOF_SIGNATURE_INVALID',
  )
  return packet.body
}
export const wrap = (text, recipient) =>
  encode(sodium.crypto_box_seal(Buffer.from(text), decode(recipient)))
export function unwrap(cipher, identity) {
  const plain = sodium.crypto_box_seal_open(
    decode(cipher),
    decode(identity.boxPublic),
    decode(identity.boxPrivate),
  )
  try {
    return Buffer.from(plain).toString('utf8')
  } finally {
    plain.fill(0)
  }
}
export function validPublic(value) {
  check(
    value &&
      Object.keys(value).sort().join(',') ===
        'accountId,boxPublic,deviceId,signPublic' &&
      typeof value.accountId === 'string' &&
      /^[0-9a-f-]{36}$/.test(value.accountId) &&
      /^[0-9a-f-]{36}$/.test(value.deviceId),
  )
  check(
    decode(value.signPublic).length === 32 &&
      decode(value.boxPublic).length === 32,
  )
  return value
}
