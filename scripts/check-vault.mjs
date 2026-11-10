import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import * as argon2 from 'argon2'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { createBackendApp } from '../server/http/app.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import { createLogger } from '../server/logging.ts'
import { VaultEngine } from '../src/features/vault/engine.ts'
import {
  destroyKeys,
  fromBase64,
  open,
  randomKey,
  recoverProfile,
  seal,
  toBase64,
  unlockProfile,
  verifyRecovery,
} from '../src/features/vault/crypto.ts'
import { deriveMasterKey } from '../src/features/vault/kdf.ts'
import { IdleLock } from '../src/features/vault/idle-lock.ts'

const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-vault-test-' + randomUUID()),
  path = join(root, 'db', 'test.sqlite')
ensurePrivateDirectory(root)
initializeDatabase(path)
const db = openInitializedDatabase(path),
  lines = [],
  wire = []
const origin = 'http://localhost:5173',
  loginPassword = 'Fictional account passphrase!',
  master = 'Fictional independent master passphrase!',
  newMaster = 'A replacement fictional master passphrase!'
const app = createBackendApp(
  createLogger('info', (line) => lines.push(line)),
  () => {},
  { db, origin, production: false, vaults: true },
)
let admin, member, engine, spouse, firstRecovery, originalDraft
async function account(username, role) {
  const invite = issueRegistrationInvite(db, role)
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { origin },
    payload: {
      username,
      password: loginPassword,
      passwordConfirmation: loginPassword,
      inviteCode: invite.inviteCode,
    },
  })
  assert.equal(registration.statusCode, 201, registration.body)
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { username, password: loginPassword },
  })
  assert.equal(response.statusCode, 200, response.body)
  const cookie = String(response.headers['set-cookie']).split(';')[0],
    csrf = response.json().csrfToken,
    id = response.json().user.id
  const request = (name, body, headers = {}) =>
    app.inject({
      method: body ? 'POST' : 'GET',
      url: '/api/vault/' + name,
      headers: { origin, cookie, 'x-csrf-token': csrf, ...headers },
      ...(body ? { payload: body } : {}),
    })
  const api = async (name, body) => {
    if (body) wire.push(JSON.stringify(body))
    const response = await request(name, body)
    if (response.statusCode !== 200) {
      const error = new Error(response.json().code)
      error.status = response.statusCode
      throw error
    }
    return response.json()
  }
  return { id, cookie, csrf, request, api }
}
try {
  await test('browser Argon2id matches native implementation and XChaCha20-Poly1305 matches published vectors', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      derived = await deriveMasterKey(master, salt)
    const expected = await argon2.hash(master, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
      salt: Buffer.from(salt),
      raw: true,
    })
    assert.deepEqual(Buffer.from(derived), expected)
    derived.fill(0)
    expected.fill(0)
    // Published construction vector, draft-irtf-cfrg-xchacha-03 section A.3.1.
    // https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha-03#appendix-A.3.1
    const key = Buffer.from(
        '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f',
        'hex',
      ),
      nonce = Buffer.from(
        '404142434445464748494a4b4c4d4e4f5051525354555657',
        'hex',
      )
    const plain = Buffer.from(
        '4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e',
        'hex',
      ),
      aad = Buffer.from('50515253c0c1c2c3c4c5c6c7', 'hex')
    const cipher = Buffer.from(
      'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49',
      'hex',
    )
    assert.deepEqual(
      Buffer.from(xchacha20poly1305(key, nonce, aad).encrypt(plain)),
      cipher,
    )
    assert.deepEqual(
      Buffer.from(xchacha20poly1305(key, nonce, aad).decrypt(cipher)),
      plain,
    )
    key.fill(0)
  })
  await test('AEAD rejects tampering, swapped context, wrong key and unsupported versions', () => {
    const key = randomKey(),
      sealed = seal(
        key,
        { password: 'Never persist this fictional plaintext' },
        'fixture',
      )
    assert.deepEqual(open(key, sealed, 'fixture'), {
      password: 'Never persist this fictional plaintext',
    })
    const bytes = fromBase64(sealed.ciphertext)
    bytes[0] ^= 1
    assert.throws(() =>
      open(key, { ...sealed, ciphertext: toBase64(bytes) }, 'fixture'),
    )
    assert.throws(() => open(key, sealed, 'different-user'))
    assert.throws(() => open(randomKey(), sealed, 'fixture'))
    assert.throws(() => open(key, { ...sealed, v: 2 }, 'fixture'))
    assert.notEqual(
      seal(key, {}, 'fixture').nonce,
      seal(key, {}, 'fixture').nonce,
    )
    key.fill(0)
  })
  await test('master creation confirms input and requires verified recovery before persistence', async () => {
    admin = await account('VaultAdmin', 'administrator')
    member = await account('VaultPartner', 'member')
    await assert.rejects(
      VaultEngine.prepare(admin.id, master, 'Mismatch fictional passphrase!'),
      /do not match/,
    )
    await assert.rejects(VaultEngine.prepare(admin.id, 'short', 'short'), /15/)
    originalDraft = await VaultEngine.prepare(admin.id, master, master)
    firstRecovery = originalDraft.recoveryCode
    assert.equal((await admin.api('state')).profile, null)
    await assert.rejects(
      VaultEngine.finishSetup(
        admin.api,
        admin.id,
        originalDraft,
        '00'.repeat(32),
      ),
    )
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM client_vault_profiles').get().n,
      0,
    )
    engine = await VaultEngine.finishSetup(
      admin.api,
      admin.id,
      originalDraft,
      firstRecovery,
    )
    assert.equal(engine.credentials.length, 0)
    assert.notDeepEqual(originalDraft.keys.root, originalDraft.keys.personal)
    assert.throws(() =>
      verifyRecovery(
        member.id,
        originalDraft.profile,
        firstRecovery,
        originalDraft.keys.root,
      ),
    )
  })
  await test('encrypted credential create/edit/read and folder/category CRUD survive lock and unlock', async () => {
    await engine.saveFolder('Fictional confidential folder', 'personal')
    const folder = engine.folders[0]
    const draft = {
      name: 'Fictional secret website',
      url: 'https://fictional.example',
      username: 'private-fictional-username',
      password: 'Fictional credential password never in SQLite!',
      notes: 'Fictional note that must never leak',
      category: 'Finance',
      vault: 'personal',
      owner: 'emmanuel',
      folderId: folder.id,
    }
    await engine.saveCredential(draft)
    assert.equal(engine.credentials.length, 1)
    assert.equal(engine.credentials[0].folderId, folder.id)
    const id = engine.credentials[0].id
    await engine.saveCredential(
      { ...draft, name: 'Updated fictional secret website' },
      id,
    )
    assert.equal(engine.credentials[0].name, 'Updated fictional secret website')
    await engine.saveFolder(
      'Renamed confidential folder',
      'personal',
      folder.id,
    )
    assert.equal(engine.folders[0].name, 'Renamed confidential folder')
    engine.lock()
    assert.equal(engine.locked, true)
    assert.throws(() => engine.credentials, /locked/)
    assert.ok(originalDraft.keys.root.every((byte) => byte === 0))
    assert.ok(originalDraft.keys.personal.every((byte) => byte === 0))
    await assert.rejects(
      VaultEngine.unlock(
        admin.api,
        admin.id,
        'Incorrect fictional master passphrase!',
      ),
      /Incorrect/,
    )
    engine = await VaultEngine.unlock(admin.api, admin.id, master)
    assert.equal(engine.credentials[0].password, draft.password)
    await engine.deleteFolder(folder.id, 'personal')
    assert.equal(engine.folders.length, 0)
    assert.equal(engine.credentials[0].folderId, undefined)
  })
  await test('personal vault access is isolated by server session and independent client keys', async () => {
    const draft = await VaultEngine.prepare(
      member.id,
      'Partner independent master passphrase!',
      'Partner independent master passphrase!',
    )
    spouse = await VaultEngine.finishSetup(
      member.api,
      member.id,
      draft,
      draft.recoveryCode,
    )
    assert.equal(spouse.credentials.length, 0)
    const adminState = await admin.api('state'),
      memberState = await member.api('state')
    assert.notEqual(adminState.personal.id, memberState.personal.id)
    await assert.rejects(
      unlockProfile(member.id, adminState.profile.data, master),
    )
    const recovered = recoverProfile(
      member.id,
      memberState.profile.data,
      draft.recoveryCode,
    )
    assert.throws(() =>
      open(
        recovered.personal,
        adminState.personal.payload,
        'vault:' + adminState.personal.id + ':' + adminState.personal.revision,
      ),
    )
    destroyKeys(recovered)
    const denied = await member.request('personal', {
      revision: memberState.personal.revision,
      payload: adminState.personal.payload,
      ownerId: admin.id,
    })
    assert.equal(denied.statusCode, 400)
    assert.equal(
      (await member.api('state')).personal.payload.ciphertext,
      memberState.personal.payload.ciphertext,
    )
  })
  await test('Household has a distinct key and requires both a separate account grant and correct transfer key', async () => {
    await engine.createHousehold()
    const code = engine.exportHousehold()
    assert.equal((await member.api('state')).household, null)
    await assert.rejects(spouse.joinHousehold(code), /invitation/)
    const noGrant = await member.request('household/save', {
      revision: 1,
      payload: (await admin.api('state')).household.payload,
    })
    assert.equal(noGrant.statusCode, 403)
    await engine.grantHousehold(member.id)
    await spouse.refresh()
    assert.equal(spouse.household.joined, false)
    const badCode = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')
    await assert.rejects(spouse.joinHousehold(badCode))
    await spouse.joinHousehold(code)
    await engine.saveCredential({
      name: 'Shared fictional credential',
      url: 'https://household.example',
      username: 'household-fictional',
      password: 'Shared fictional password!',
      notes: 'Household note',
      category: 'Personal',
      vault: 'shared',
      owner: 'emmanuel',
    })
    await spouse.refresh()
    assert.equal(spouse.credentials.length, 1)
    assert.equal(spouse.credentials[0].vault, 'shared')
    assert.equal(
      engine.credentials.filter((item) => item.vault === 'personal').length,
      1,
    )
    const profile = await admin.api('state'),
      keys = await unlockProfile(admin.id, profile.profile.data, master)
    assert.notDeepEqual(keys.personal, keys.household.key)
    assert.throws(() =>
      open(
        keys.personal,
        profile.household.payload,
        'vault:' + profile.household.id + ':' + profile.household.revision,
      ),
    )
    destroyKeys(keys)
  })
  await test('conflicting writes fail without erasing updates and cross-vault moves are atomic', async () => {
    const consistent = await admin.api('state')
    const conflicted = await admin.request('move', {
      personalRevision: consistent.personal.revision,
      personal: consistent.personal.payload,
      sharedRevision: consistent.household.revision - 1,
      shared: consistent.household.payload,
    })
    assert.equal(conflicted.statusCode, 409)
    assert.deepEqual((await admin.api('state')).personal, consistent.personal)
    const stale = await VaultEngine.unlock(admin.api, admin.id, master)
    await engine.saveFolder('Additional personal folder', 'personal')
    await assert.rejects(
      stale.saveFolder('Stale write must fail', 'personal'),
      /VAULT_CONFLICT/,
    )
    stale.lock()
    const item = engine.credentials.find((value) => value.vault === 'personal')
    await engine.saveCredential(
      { ...item, vault: 'shared', folderId: undefined },
      item.id,
    )
    assert.equal(
      engine.credentials.filter((value) => value.vault === 'personal').length,
      0,
    )
    await spouse.refresh()
    assert.equal(spouse.credentials.length, 2)
    const shared = spouse.credentials[0]
    await spouse.saveCredential(
      { ...shared, notes: 'Updated by separately authorised account' },
      shared.id,
    )
    await engine.refresh()
    assert.equal(
      engine.credentials.find((value) => value.id === shared.id).notes,
      'Updated by separately authorised account',
    )
    await spouse.deleteCredential(shared.id)
    await engine.refresh()
    assert.equal(engine.credentials.length, 1)
  })
  await test('Household revocation rotates keys atomically and a fresh grant rejects the old transfer key', async () => {
    const oldCode = engine.exportHousehold(),
      before = await admin.api('state')
    await assert.rejects(spouse.revokeHousehold(admin.id), /owner/)
    await engine.revokeHousehold(member.id)
    const after = await admin.api('state')
    assert.notEqual(
      before.household.payload.ciphertext,
      after.household.payload.ciphertext,
    )
    assert.notEqual(engine.exportHousehold(), oldCode)
    await spouse.refresh()
    assert.equal(spouse.household, null)
    assert.equal(spouse.credentials.length, 0)
    const denied = await member.request('household/save', {
      revision: after.household.revision,
      payload: after.household.payload,
    })
    assert.equal(denied.statusCode, 403)
    await engine.grantHousehold(member.id)
    await spouse.refresh()
    await assert.rejects(spouse.joinHousehold(oldCode))
    await spouse.joinHousehold(engine.exportHousehold())
    assert.equal(
      spouse.credentials.length,
      engine.credentials.filter((item) => item.vault === 'shared').length,
    )
  })
  await test('master changes retain ciphertext/recovery and reject old or wrong current passwords', async () => {
    const before = await admin.api('state')
    await assert.rejects(
      engine.changeMaster(
        'Incorrect current master passphrase!',
        newMaster,
        newMaster,
      ),
      /Incorrect/,
    )
    await assert.rejects(
      engine.changeMaster(
        master,
        newMaster,
        'Mismatched confirmation passphrase!',
      ),
      /match/,
    )
    await engine.changeMaster(master, newMaster, newMaster)
    const after = await admin.api('state')
    assert.deepEqual(after.personal, before.personal)
    assert.deepEqual(after.household, before.household)
    assert.deepEqual(after.profile.data.recovery, before.profile.data.recovery)
    engine.verifyRecovery(firstRecovery)
    engine.lock()
    await assert.rejects(
      VaultEngine.unlock(admin.api, admin.id, master),
      /Incorrect/,
    )
    engine = await VaultEngine.unlock(admin.api, admin.id, newMaster)
    assert.equal(engine.credentials.length, 1)
  })
  await test('recovery verifies possession, rotates its key, replaces master and preserves all ciphertext', async () => {
    engine.lock()
    const before = await admin.api('state')
    await assert.rejects(
      VaultEngine.prepareRecovery(
        admin.api,
        admin.id,
        '00'.repeat(32),
        master,
        master,
      ),
    )
    const pending = await VaultEngine.prepareRecovery(
      admin.api,
      admin.id,
      firstRecovery,
      master,
      master,
    )
    await assert.rejects(
      VaultEngine.finishRecovery(admin.api, admin.id, pending, '11'.repeat(32)),
    )
    assert.deepEqual((await admin.api('state')).profile, before.profile)
    engine = await VaultEngine.finishRecovery(
      admin.api,
      admin.id,
      pending,
      pending.recoveryCode,
    )
    assert.throws(() => engine.verifyRecovery(firstRecovery))
    engine.verifyRecovery(pending.recoveryCode)
    const after = await admin.api('state')
    assert.deepEqual(after.personal, before.personal)
    assert.deepEqual(after.household, before.household)
    engine.lock()
    engine = await VaultEngine.unlock(admin.api, admin.id, master)
    assert.equal(engine.credentials.length, 1)
  })
  await test('tampered stored ciphertext fails closed rather than loading an empty vault', async () => {
    const state = await admin.api('state'),
      payload = structuredClone(state.household.payload),
      bytes = fromBase64(payload.ciphertext)
    bytes[0] ^= 1
    payload.ciphertext = toBase64(bytes)
    db.prepare('UPDATE client_vaults SET payload=? WHERE id=?').run(
      JSON.stringify(payload),
      state.household.id,
    )
    await assert.rejects(VaultEngine.unlock(admin.api, admin.id, master))
    await assert.rejects(engine.refresh())
    assert.equal(engine.locked, true)
    assert.throws(() => engine.credentials, /locked/)
    db.prepare('UPDATE client_vaults SET payload=? WHERE id=?').run(
      JSON.stringify(state.household.payload),
      state.household.id,
    )
    engine = await VaultEngine.unlock(admin.api, admin.id, master)
  })
  await test('idle expiry cannot be extended by activity after deadline or suspended-tab return', () => {
    let time = 0,
      locks = 0
    const idle = new IdleLock(
      () => locks++,
      300000,
      () => time,
    )
    time = 299999
    assert.equal(idle.check(), false)
    idle.touch()
    time += 299999
    assert.equal(idle.check(), false)
    time += 1
    idle.touch()
    assert.equal(locks, 1)
    idle.check()
    assert.equal(locks, 1)
  })
  await test('vault APIs enforce sessions, CSRF, origin and strict ciphertext-only request shapes', async () => {
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/vault/state' })).statusCode,
      401,
    )
    const state = await admin.api('state'),
      body = {
        revision: state.personal.revision,
        payload: state.personal.payload,
      }
    assert.equal(
      (await admin.request('personal', body, { 'x-csrf-token': 'bad' }))
        .statusCode,
      403,
    )
    assert.equal(
      (
        await admin.request('personal', body, {
          origin: 'https://attacker.example',
        })
      ).statusCode,
      403,
    )
    assert.equal(
      (
        await admin.request('personal', {
          ...body,
          password: 'Forbidden plaintext',
        })
      ).statusCode,
      400,
    )
    assert.equal(
      (
        await admin.request('profile', {
          revision: state.profile.revision,
          profile: { ...state.profile.data, masterPassword: master },
        })
      ).statusCode,
      400,
    )
    assert.equal(
      (
        await admin.request('profile', {
          revision: state.profile.revision,
          profile: {
            ...state.profile.data,
            kdf: { ...state.profile.data.kdf, memory: 8 },
          },
        })
      ).statusCode,
      400,
    )
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/google-drive/connect',
        })
      ).statusCode,
      503,
    )
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  })
  await test('SQLite, WAL, logs and vault requests contain no plaintext credentials, master/recovery keys or folder names', () => {
    const sensitive = [
      master,
      newMaster,
      firstRecovery,
      'Fictional secret website',
      'Updated fictional secret website',
      'private-fictional-username',
      'https://fictional.example',
      'Fictional credential password never in SQLite!',
      'Fictional note that must never leak',
      'Renamed confidential folder',
      'Shared fictional password!',
    ]
    const files = readdirSync(join(root, 'db'))
      .filter((name) => name.startsWith('test.sqlite'))
      .map((name) => readFileSync(join(root, 'db', name)))
    const database = Buffer.concat(files),
      requests = wire.join('\n'),
      logs = lines.join('\n')
    for (const text of sensitive) {
      assert.ok(
        !database.includes(Buffer.from(text)),
        'Plaintext in SQLite artifacts',
      )
      assert.ok(!requests.includes(text), 'Plaintext sent to vault API')
      assert.ok(!logs.includes(text), 'Plaintext in logs')
    }
    const records = db
      .prepare('SELECT data FROM client_vault_profiles')
      .all()
      .map((value) => value.data)
      .join('')
    assert.ok(
      !records.includes('personalKey') && !records.includes(firstRecovery),
    )
    assert.equal(db.prepare('SELECT count(*) AS n FROM credentials').get().n, 0)
  })
} finally {
  engine?.lock()
  spouse?.lock()
  await app.close()
  db.close()
  assert.ok(
    resolve(root).startsWith(resolve(parent) + sep) &&
      root.includes('lockbox-vault-test-'),
  )
  rmSync(root, { recursive: true, force: true })
}
