/** Wire format: ciphertext and public routing/version metadata only. Never add plaintext fields. */
export interface Envelope {
  v: 1
  alg: 'XChaCha20-Poly1305'
  nonce: string
  ciphertext: string
}
export interface VaultProfile {
  v: 1
  kdf: {
    name: 'Argon2id'
    memory: 65536
    iterations: 3
    parallelism: 1
    salt: string
  }
  master: Envelope
  recovery: Envelope
  keyring: Envelope
}
export interface StoredProfile {
  revision: number
  data: VaultProfile
}
export interface StoredVault {
  id: string
  scope: 'personal' | 'shared'
  ownerId: string
  revision: number
  payload: Envelope
  check: Envelope | null
}
export interface VaultState {
  profile: StoredProfile | null
  personal: StoredVault | null
  household: (StoredVault & { joined: boolean }) | null
  candidates: {
    id: string
    username: string
    access?: 'none' | 'invited' | 'joined'
  }[]
}
