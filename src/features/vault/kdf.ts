import { argon2id } from 'hash-wasm'
export function validMasterPassword(value: string) {
  return (
    !/[\uD800-\uDFFF]/u.test(value) &&
    [...value].length >= 15 &&
    [...value].length <= 128 &&
    new TextEncoder().encode(value).length <= 512
  )
}
/** Fixed Argon2id profile using the RFC 9106 algorithm; reject unbounded stored parameters. */
export async function deriveMasterKey(password: string, salt: Uint8Array) {
  if (!validMasterPassword(password) || salt.length !== 16)
    throw new Error(
      'Use a master passphrase of 15–128 characters (at most 512 UTF-8 bytes).',
    )
  return argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: 'binary',
  })
}
