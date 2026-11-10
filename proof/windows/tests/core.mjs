import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join, resolve, sep, dirname } from 'node:path'
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { VaultEngine } from '../../../src/features/vault/engine.ts'
import { open, toBase64 } from '../../../src/features/vault/crypto.ts'
import { PrivateStore } from '../native/store.mjs'
import { Replica } from '../native/replica.mjs'
import { NativeDrive } from '../native/drive.mjs'
import { hash, publicIdentity, clone } from '../native/identity.mjs'
import { FictionalGoogle } from './google-fixture.mjs'
const parent = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../server/.data',
  ),
  root = resolve(parent, 'lockbox-native-proof-test-' + randomUUID()),
  google = new FictionalGoogle()
function protector() {
  const key = randomBytes(32)
  return {
    available: () => true,
    encrypt(text) {
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, nonce),
        bytes = Buffer.concat([cipher.update(text), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes])
    },
    decrypt(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString('utf8')
    },
  }
}
const protectA = protector(),
  protectB = protector(),
  storeA = new PrivateStore(join(root, 'owner'), protectA),
  storeB = new PrivateStore(join(root, 'partner'), protectB)
const drive = (person) =>
  new NativeDrive(
    { access: async () => 'fictional-' + person },
    { fetch: google.fetch.bind(google), sleep: async () => {} },
  )
const a = new Replica(storeA, 'owner', () => drive('owner'))
let b = new Replica(storeB, 'partner', () => drive('partner'))
const apiA = async (path, body) => a.api(path, body),
  apiB = async (path, body) => b.api(path, body),
  masterA = 'Fictional owner master passphrase 123!',
  masterB = 'Fictional partner master passphrase 456!'
let ea, eb, preparedA, preparedB, grant
const draft = (name, vault = 'personal') => ({
  name: 'Fictional ' + name,
  url: 'https://service.example.invalid',
  username: 'fictional@example.invalid',
  password: 'Fictional-saved-secret-' + name,
  notes: 'Fictional confidential notes ' + name,
  category: 'Personal',
  vault,
  owner: 'emmanuel',
})
try {
  await test('two local encrypted profiles reuse existing Argon2id, recovery confirmation and independent personal keys without an account service', async () => {
    preparedA = await VaultEngine.prepare(a.id, masterA, masterA)
    preparedB = await VaultEngine.prepare(b.id, masterB, masterB)
    await assert.rejects(() =>
      VaultEngine.finishSetup(apiA, a.id, preparedA, 'incorrect'),
    )
    ea = await VaultEngine.finishSetup(
      apiA,
      a.id,
      preparedA,
      preparedA.recoveryCode,
    )
    eb = await VaultEngine.finishSetup(
      apiB,
      b.id,
      preparedB,
      preparedB.recoveryCode,
    )
    await ea.saveCredential(draft('owner-only'))
    await eb.saveCredential(draft('partner-only'))
    assert.notEqual(
      toBase64(preparedA.keys.personal),
      toBase64(preparedB.keys.personal),
    )
    assert.throws(() =>
      open(
        preparedB.keys.personal,
        a.state().personal.payload,
        'vault:' + a.state().personal.id + ':' + a.state().personal.revision,
      ),
    )
    await assert.rejects(() =>
      VaultEngine.unlock(apiA, a.id, 'Fictional wrong master passphrase!'),
    )
  })
  await test('owner uses newly created private fictional folders; Household grant requires another Google principal and verified fingerprint', async () => {
    a.account(google.users.owner)
    b.account(google.users.partner)
    await a.createFolders()
    await ea.createHousehold()
    await assert.rejects(() =>
      a.grant(b.pairing(), 'not-verified', ea.exportHousehold()),
    )
    grant = await a.grant(
      b.pairing(),
      hash(publicIdentity(b.data.identity)),
      ea.exportHousehold(),
    )
    assert.deepEqual(a.data.grantPacket, grant)
    assert.equal(
      JSON.stringify(grant).includes(toBase64(preparedA.keys.personal)),
      false,
    )
    assert.equal(
      JSON.stringify(grant).includes(toBase64(preparedB.keys.personal)),
      false,
    )
    assert.throws(() => b.importGrant(grant, 'wrong-fingerprint'))
    b.importGrant(grant, hash(publicIdentity(a.data.identity)))
    await assert.rejects(
      () => b.sync(),
      /PROOF_GOOGLE_FOLDER_PERMISSION_REQUIRED/,
    )
    google.authorize('partner', [
      b.data.folders.personal,
      b.data.folders.shared,
    ])
    await b.sync()
    await eb.refresh()
    await eb.joinHousehold(b.householdCode())
    await b.sync()
    assert.equal(eb.household.joined, true)
    for (const file of google.files.values())
      assert.equal(
        google.permissions(file).some((p) => p.type !== 'user'),
        false,
      )
  })
  await test('direct encrypted upload/readback and Household download preserve personal isolation, including from the folder owner', async () => {
    await ea.saveCredential(draft('household', 'shared'))
    await a.sync()
    await b.sync()
    await eb.refresh()
    assert.ok(eb.credentials.some((c) => c.name === 'Fictional household'))
    assert.equal(
      eb.credentials.some((c) => c.name === 'Fictional owner-only'),
      false,
    )
    assert.equal(
      ea.credentials.some((c) => c.name === 'Fictional partner-only'),
      false,
    )
    const ownFile = [...google.files.values()].find(
      (f) => f.parents?.[0] === a.data.folders.personal && f.packet,
    )
    await assert.rejects(
      () => drive('partner').read(ownFile.id, a.data.folders.personal),
      /PERMISSION/,
    )
    const partnerFile = [...google.files.values()].find(
      (f) => f.parents?.[0] === b.data.folders.personal && f.packet,
    )
    const snapshot = partnerFile.packet.body.snapshot.vault
    assert.throws(() =>
      open(
        preparedA.keys.personal,
        snapshot.payload,
        'vault:' + snapshot.id + ':' + snapshot.revision,
      ),
    )
    const traffic = JSON.stringify(google.requests)
    for (const value of [
      'Fictional-saved-secret',
      'Fictional confidential notes',
      masterA,
      masterB,
      preparedA.recoveryCode,
      preparedB.recoveryCode,
      toBase64(preparedA.keys.personal),
      toBase64(preparedB.keys.personal),
    ])
      assert.equal(traffic.includes(value), false)
  })
  await test('offline edits persist through restart and reconnect while the other installation is unavailable', async () => {
    google.offline.add('partner')
    await eb.saveCredential(draft('offline-shared', 'shared'))
    await assert.rejects(() => b.sync(), /NETWORK/)
    eb.lock()
    b = new Replica(
      new PrivateStore(join(root, 'partner'), protectB),
      'partner',
      () => drive('partner'),
    )
    eb = await VaultEngine.unlock(apiB, b.id, masterB)
    assert.ok(eb.credentials.some((c) => c.name === 'Fictional offline-shared'))
    const previous = a.getDrive
    a.getDrive = () => {
      throw new Error('Other installation is stopped')
    }
    google.offline.delete('partner')
    await b.sync()
    a.getDrive = previous
    await a.sync()
    await ea.refresh()
    assert.ok(ea.credentials.some((c) => c.name === 'Fictional offline-shared'))
  })
  await test('lost upload responses retry the same allocated ID without duplicate or mutable-head overwrites', async () => {
    await ea.saveCredential(draft('lost-response'))
    google.failAfterCreate = true
    await a.sync()
    const own = [...google.files.values()].filter(
      (f) => f.packet?.body.author.accountId === a.id,
    )
    const hashes = own.map((f) => hash(f.packet))
    assert.equal(new Set(hashes).size, hashes.length)
  })
  await test('tampered ciphertext and namespace substitution are rejected without deleting local data', async () => {
    const before = clone(b.state()),
      file = [...google.files.values()].find(
        (f) => f.parents?.[0] === b.data.folders.shared && f.packet,
      ),
      original = clone(file.packet)
    file.packet.body.snapshot.vault.payload.ciphertext = 'A'.repeat(64)
    await assert.rejects(() => b.sync(), /SIGNATURE/)
    assert.deepEqual(b.state(), before)
    file.packet = original
    const forged = clone(original)
    forged.body.scope = 'personal'
    assert.throws(() => b.validateCommit(forged, 'personal'), /PERSONAL/)
  })
  await test('simultaneous Household edits retain both signed branches and visibly block destructive overwrites', async () => {
    await a.sync()
    await b.sync()
    await ea.refresh()
    await eb.refresh()
    await ea.saveCredential(draft('concurrent-owner', 'shared'))
    await eb.saveCredential(draft('concurrent-partner', 'shared'))
    await a.sync()
    await b.sync()
    await a.sync()
    assert.equal(a.status().conflicts.household.length, 2)
    assert.equal(b.status().conflicts.household.length, 2)
    assert.ok(
      ea.credentials.some((c) => c.name === 'Fictional concurrent-owner'),
    )
    assert.ok(
      eb.credentials.some((c) => c.name === 'Fictional concurrent-partner'),
    )
    await assert.rejects(
      () => ea.saveCredential(draft('must-not-overwrite', 'shared')),
      /REVISION/,
    )
  })
  await test('recovery and master change preserve personal ciphertext; local persistence contains no plaintext credential or private key material', async () => {
    const personal = clone(a.state().personal.payload)
    await ea.changeMaster(
      masterA,
      'Fictional replacement master passphrase!',
      'Fictional replacement master passphrase!',
    )
    ea.lock()
    await assert.rejects(() => VaultEngine.unlock(apiA, a.id, masterA))
    ea = await VaultEngine.unlock(
      apiA,
      a.id,
      'Fictional replacement master passphrase!',
    )
    assert.deepEqual(a.state().personal.payload, personal)
    const recovery = await VaultEngine.prepareRecovery(
      apiA,
      a.id,
      preparedA.recoveryCode,
      masterA,
      masterA,
    )
    ea.lock()
    ea = await VaultEngine.finishRecovery(
      apiA,
      a.id,
      recovery,
      recovery.recoveryCode,
    )
    assert.deepEqual(a.state().personal.payload, personal)
    for (const store of [storeA, storeB]) {
      const bytes = readFileSync(store.file).toString('utf8')
      for (const value of [
        'Fictional-saved-secret',
        masterA,
        masterB,
        a.data.identity.signPrivate,
        b.data.identity.boxPrivate,
      ])
        assert.equal(bytes.includes(value), false)
    }
  })
} finally {
  ea?.lock()
  eb?.lock()
  if (resolve(root).startsWith(resolve(parent) + sep))
    rmSync(root, { recursive: true, force: true })
}
