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
import {
  open,
  toBase64,
  unlockProfile,
  destroyKeys,
  randomKey,
} from '../../../src/features/vault/crypto.ts'
import { PrivateStore } from '../native/store.mjs'
import { Replica } from '../native/replica.mjs'
import { NativeDrive } from '../native/drive.mjs'
import {
  hash,
  publicIdentity,
  clone,
  newIdentity,
} from '../native/identity.mjs'
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
const apiA = async (path, body) =>
    a.api(
      path,
      body,
      path === 'setup' ? toBase64(preparedA.keys.root) : undefined,
    ),
  apiB = async (path, body) =>
    b.api(
      path,
      body,
      path === 'setup' ? toBase64(preparedB.keys.root) : undefined,
    ),
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
    assert.equal(a.status().identityUnlocked, false)
    assert.throws(() => a.importGrant(null, ''), /PROOF_VAULT_LOCKED/)
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
  await test('device keys are root-wrapped atomically at setup; lock, wrong roots and tampering fail closed', async () => {
    const before = clone(a.data)
    assert.equal('signPrivate' in a.data.identity, false)
    assert.equal('boxPrivate' in a.data.identity, false)
    assert.ok(a.data.identityEnvelope)
    const privateIdentity = clone(a.requireIdentity())
    a.lockIdentity()
    assert.throws(() => a.requireIdentity(), /PROOF_VAULT_LOCKED/)
    assert.throws(() => a.unlockIdentity(toBase64(randomKey())))
    assert.deepEqual(a.data, before)
    assert.throws(() => a.requireIdentity(), /PROOF_VAULT_LOCKED/)
    a.unlockIdentity(toBase64(preparedA.keys.root))
    assert.deepEqual(a.requireIdentity(), privateIdentity)
    a.data.identityEnvelope.ciphertext =
      a.data.identityEnvelope.ciphertext.replace(/^./, (c) =>
        c === 'A' ? 'B' : 'A',
      )
    assert.throws(() => a.unlockIdentity(toBase64(preparedA.keys.root)))
    assert.throws(() => a.requireIdentity(), /PROOF_VAULT_LOCKED/)
    a.data = before
    a.unlockIdentity(toBase64(preparedA.keys.root))
  })
  await test('previous fictional profiles upgrade only after root verification and preserve their identity and ciphertext', async () => {
    const legacy = clone(a.data),
      identity = newIdentity()
    legacy.identity = identity
    delete legacy.identityEnvelope
    let saved = clone(legacy)
    const store = {
      load: () => clone(saved),
      save: (value) => {
        saved = clone(value)
      },
    }
    const replica = new Replica(store, 'owner', () => drive('owner'))
    // Rebind a disposable legacy fixture to its own account ID/keyring context.
    const prepared = await VaultEngine.prepare(
      identity.accountId,
      masterA,
      masterA,
    )
    replica.data.state.profile.data = prepared.profile
    replica.save()
    const payload = clone(replica.data.state.personal.payload)
    assert.throws(() => replica.unlockIdentity(toBase64(randomKey())))
    assert.deepEqual(saved.identity, identity)
    const save = store.save
    store.save = () => {
      throw new Error('Fictional disk failure')
    }
    assert.throws(
      () => replica.unlockIdentity(toBase64(prepared.keys.root)),
      /Fictional disk failure/,
    )
    assert.deepEqual(replica.data.identity, identity)
    assert.equal(replica.data.identityEnvelope, undefined)
    assert.throws(() => replica.requireIdentity(), /PROOF_VAULT_LOCKED/)
    store.save = save
    replica.unlockIdentity(toBase64(prepared.keys.root))
    assert.deepEqual(replica.requireIdentity(), identity)
    assert.deepEqual(saved.identity, publicIdentity(identity))
    assert.deepEqual(saved.state.personal.payload, payload)
    const restarted = new Replica(store, 'owner', () => drive('owner'))
    assert.throws(() => restarted.requireIdentity(), /PROOF_VAULT_LOCKED/)
    restarted.unlockIdentity(toBase64(prepared.keys.root))
    assert.deepEqual(restarted.requireIdentity(), identity)
    restarted.identityDeadline = performance.now() - 1
    assert.equal(restarted.touchIdentity(), false)
    assert.throws(() => restarted.requireIdentity(), /PROOF_VAULT_LOCKED/)
    restarted.identityIdleMs = 20
    restarted.unlockIdentity(toBase64(prepared.keys.root))
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.throws(() => restarted.requireIdentity(), /PROOF_VAULT_LOCKED/)
    assert.equal(restarted.touchIdentity(), false)
    destroyKeys(prepared.keys)
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
    b.lockIdentity()
    assert.throws(() => b.householdCode(), /PROOF_VAULT_LOCKED/)
    b.unlockIdentity(toBase64(preparedB.keys.root))
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
    assert.throws(() => b.pairing(), /PROOF_VAULT_LOCKED/)
    const keys = await unlockProfile(b.id, b.state().profile.data, masterB)
    try {
      b.unlockIdentity(toBase64(keys.root))
    } finally {
      destroyKeys(keys)
    }
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
  await test(
    'local edits during a stalled Drive request remain usable, retained and subsequently upload without overwriting history',
    { timeout: 45000 },
    async () => {
      await a.sync()
      await ea.refresh()
      const original = a.getDrive,
        provider = drive('owner'),
        list = provider.list.bind(provider)
      let release,
        entered,
        paused = false
      const gate = new Promise((resolve) => {
          release = resolve
        }),
        waiting = new Promise((resolve) => {
          entered = resolve
        })
      provider.list = async (folder) => {
        if (!paused) {
          paused = true
          entered()
          await gate
        }
        return list(folder)
      }
      a.getDrive = () => provider
      const syncing = a.sync()
      try {
        await waiting
        await ea.saveCredential(draft('during-stalled-sync'))
        assert.ok(
          ea.credentials.some(
            (c) => c.name === 'Fictional during-stalled-sync',
          ),
        )
        release()
        await syncing
        assert.ok(a.status().pendingChanges > 0)
        await a.sync()
        await ea.refresh()
        assert.equal(a.status().pendingChanges, 0)
        const known = [...google.files.values()].find(
          (f) =>
            f.packet?.body.scope === 'personal' &&
            f.packet.body.author.accountId === a.id,
        )
        const knownHash = hash(known.packet)
        delete a.data.uploads[knownHash] // A restored checkpoint may not know this already-published commit.
        await a.sync()
        assert.equal(a.data.uploads[knownHash].done, true)
        google.files.delete(known.id)
        try {
          await assert.rejects(() => a.sync(), /CLOUD_HISTORY_MISSING/)
        } finally {
          google.files.set(known.id, known)
        }

        assert.ok(
          ea.credentials.some(
            (c) => c.name === 'Fictional during-stalled-sync',
          ),
        )
      } finally {
        release()
        await syncing.catch(() => {})
        a.getDrive = original
      }
    },
  )
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
  await test('explicit Household conflict resolution converges across independent installations and retained losing entries can be recovered', async () => {
    const versions = a.conflictVersions('household'),
      heads = versions.map((v) => v.id),
      chosen = versions.find((v) => v.author.accountId === a.id),
      other = versions.find((v) => v.id !== chosen.id)
    assert.throws(
      () => a.resolveConflict('household', chosen.id, [chosen.id]),
      /CONFLICT_CHANGED/,
    )
    const retained = a.data.journal.household.map(hash)
    a.resolveConflict('household', chosen.id, heads)
    assert.ok(
      retained.every((id) =>
        a.data.journal.household.some((p) => hash(p) === id),
      ),
    )
    await a.sync()
    await b.sync()
    await ea.refresh()
    await eb.refresh()
    assert.equal(a.status().conflicts.household.length, 0)
    assert.equal(b.status().conflicts.household.length, 0)
    assert.ok(
      ea.credentials.some((c) => c.name === 'Fictional concurrent-owner'),
    )
    assert.equal(
      eb.credentials.some((c) => c.name === 'Fictional concurrent-partner'),
      false,
    )
    await ea.restoreRevision(other.snapshot.vault)
    await a.sync()
    await b.sync()
    await eb.refresh()
    assert.ok(
      eb.credentials.some((c) => c.name === 'Fictional concurrent-owner'),
    )
    assert.ok(
      eb.credentials.some((c) => c.name === 'Fictional concurrent-partner'),
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
    a.lockIdentity()
    const keys = await unlockProfile(a.id, a.state().profile.data, masterA)
    try {
      a.unlockIdentity(toBase64(keys.root))
    } finally {
      destroyKeys(keys)
    }
    for (const store of [storeA, storeB]) {
      const bytes = readFileSync(store.file).toString('utf8')
      for (const value of [
        'Fictional-saved-secret',
        masterA,
        masterB,
        a.requireIdentity().signPrivate,
        b.requireIdentity().boxPrivate,
      ])
        assert.equal(bytes.includes(value), false)
    }
  })
} finally {
  ea?.lock()
  eb?.lock()
  a.lockIdentity()
  b.lockIdentity()
  if (resolve(root).startsWith(resolve(parent) + sep))
    rmSync(root, { recursive: true, force: true })
}
