import { check } from './errors.mjs'
const keys = (value, expected) =>
  check(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === expected.sort().join(','),
  )
export function envelope(value) {
  keys(value, ['v', 'alg', 'nonce', 'ciphertext'])
  check(value.v === 1 && value.alg === 'XChaCha20-Poly1305')
  for (const field of ['nonce', 'ciphertext'])
    check(
      typeof value[field] === 'string' &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          value[field],
        ),
    )
  check(
    value.nonce.length === 32 &&
      value.ciphertext.length >= 24 &&
      value.ciphertext.length <= 900000,
  )
  return value
}
export function profile(value) {
  keys(value, ['v', 'kdf', 'master', 'recovery', 'keyring'])
  keys(value.kdf, ['name', 'memory', 'iterations', 'parallelism', 'salt'])
  check(
    value.v === 1 &&
      value.kdf.name === 'Argon2id' &&
      value.kdf.memory === 65536 &&
      value.kdf.iterations === 3 &&
      value.kdf.parallelism === 1 &&
      /^[A-Za-z0-9+/]{22}==$/.test(value.kdf.salt),
  )
  for (const field of ['master', 'recovery', 'keyring']) envelope(value[field])
  return value
}
export function stored(value) {
  keys(value, ['id', 'scope', 'ownerId', 'revision', 'payload', 'check'])
  check(
    typeof value.id === 'string' &&
      value.id.length <= 80 &&
      ['personal', 'shared'].includes(value.scope) &&
      typeof value.ownerId === 'string' &&
      /^[0-9a-f-]{36}$/.test(value.ownerId),
  )
  check(Number.isSafeInteger(value.revision) && value.revision >= 1)
  envelope(value.payload)
  if (value.check !== null) envelope(value.check)
  return value
}
export function contents(value, scope, owner, id) {
  keys(value, scope === 'personal' ? ['profile', 'vault'] : ['vault'])
  stored(value.vault)
  check(
    value.vault.id === id &&
      value.vault.scope === (scope === 'personal' ? 'personal' : 'shared') &&
      value.vault.ownerId === owner,
  )
  if (scope === 'personal') {
    keys(value.profile, ['revision', 'data'])
    check(
      Number.isSafeInteger(value.profile.revision) &&
        value.profile.revision > 0,
    )
    profile(value.profile.data)
  }
  return value
}
