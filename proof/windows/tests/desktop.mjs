import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { Replica } from '../native/replica.mjs'
import { clone } from '../native/identity.mjs'
import {
  readPortableBackup,
  backupDestination,
} from '../native/portable-backup.mjs'
import { SecretClipboard } from '../native/secret-clipboard.mjs'
import { installFiles } from '../native/install.mjs'
import { VaultEngine } from '../../../src/features/vault/engine.ts'
import {
  unlockProfile,
  toBase64,
  randomKey,
  destroyKeys,
  recoverProfile,
  rewrapMaster,
  rotateRecovery,
} from '../../../src/features/vault/crypto.ts'
const master = 'Fictional Windows master password 123!'
function empty(role = 'owner', initial) {
  let record = initial ? clone(initial) : null
  const store = {
    fail: false,
    load: () => record && clone(record),
    save(value) {
      if (this.fail) throw new Error('Fictional disk write failed')
      record = clone(value)
    },
  }
  const replica = new Replica(store, role, () => {
    throw new Error('No Google transport for offline test')
  })
  let setupRoot
  const api = async (path, body) => replica.api(path, body, setupRoot)
  return {
    replica,
    api,
    store,
    persisted: () => clone(record),
    setup: async () => {
      const prepared = await VaultEngine.prepare(replica.id, master, master)
      setupRoot = toBase64(prepared.keys.root)
      const engine = await VaultEngine.finishSetup(
        api,
        replica.id,
        prepared,
        prepared.recoveryCode,
      )
      setupRoot = undefined
      return { engine, prepared }
    },
  }
}
const item = (name, vault = 'personal') => ({
  name: 'Fictional ' + name,
  url: 'https://example.invalid',
  username: 'fictional@example.invalid',
  password: 'Fictional-secret-' + name,
  notes: 'Fictional notes ' + name,
  category: 'Personal',
  vault,
  owner: 'emmanuel',
})
await test('offline Personal and Household CRUD, folders and cross-vault moves require no Google or backend', async () => {
  const local = empty()
  const { engine } = await local.setup()
  try {
    await engine.createHousehold()
    await engine.saveFolder('Fictional private folder', 'personal')
    const folder = engine.folders[0]
    await engine.saveCredential({ ...item('local'), folderId: folder.id })
    const saved = engine.credentials[0]
    await engine.saveCredential(
      { ...item('moved', 'shared'), folderId: undefined },
      saved.id,
    )
    assert.equal(engine.credentials.filter((c) => c.id === saved.id).length, 1)
    assert.equal(engine.credentials[0].vault, 'shared')
    const before = local.persisted()
    local.store.fail = true
    await assert.rejects(
      () => engine.saveCredential(item('failed-move'), saved.id),
      /disk write/,
    )
    local.store.fail = false
    assert.deepEqual(local.persisted(), before)
    assert.equal(engine.credentials[0].vault, 'shared')
    await engine.saveFolder('Fictional renamed folder', 'personal', folder.id)
    await engine.deleteFolder(folder.id, 'personal')
    assert.equal(engine.folders.length, 0)
    const disk = JSON.stringify(local.persisted())
    assert.equal(disk.includes('Fictional-secret'), false)
    assert.equal(disk.includes('Fictional renamed folder'), false)
    await engine.deleteCredential(saved.id)
    assert.equal(engine.credentials.length, 0)
  } finally {
    engine.lock()
    local.replica.lockIdentity()
  }
})
await test('portable backup restores on a new installation without OS keys or OAuth tokens and cannot overwrite an existing vault', async () => {
  const source = empty(),
    target = empty()
  const { engine, prepared } = await source.setup()
  let restored
  try {
    await engine.saveCredential(item('portable'))
    source.replica.data.tokens = {
      access: 'Fictional-access-token',
      refresh: 'Fictional-refresh-token',
    }
    const originalIdentity = clone(source.replica.requireIdentity()),
      encoded = toBase64(prepared.keys.root),
      backup = source.replica.exportBackup(encoded)
    assert.equal(JSON.stringify(backup).includes('Fictional-secret'), false)
    assert.equal(
      JSON.stringify(backup).includes('Fictional-refresh-token'),
      false,
    )
    assert.equal(readPortableBackup(backup, encoded, 'owner').tokens, undefined)
    target.replica.restoreBackup(backup, encoded)
    assert.equal(target.replica.status().identityUnlocked, false)
    assert.equal(target.replica.data.tokens, undefined)
    const keys = await unlockProfile(
      target.replica.id,
      target.replica.state().profile.data,
      master,
    )
    try {
      target.replica.unlockIdentity(toBase64(keys.root))
    } finally {
      destroyKeys(keys)
    }
    assert.deepEqual(target.replica.requireIdentity(), originalIdentity)
    restored = await VaultEngine.unlock(target.api, target.replica.id, master)
    assert.equal(restored.credentials[0].password, 'Fictional-secret-portable')
    const before = target.persisted()
    assert.throws(
      () => target.replica.restoreBackup(backup, encoded),
      /EMPTY_PROFILE/,
    )
    assert.deepEqual(target.persisted(), before)
    // Explicit limitation: cloning a recovered identity does not revoke its source.
    await engine.saveCredential(item('source-still-authorised'))
    assert.equal(engine.credentials.length, 2)
  } finally {
    engine.lock()
    restored?.lock()
    source.replica.lockIdentity()
    target.replica.lockIdentity()
  }
})
await test('wrong roots, tampered backup, wrong roles and interrupted restoration leave the destination unchanged', async () => {
  const source = empty(),
    target = empty(),
    partner = empty('partner')
  const { engine, prepared } = await source.setup()
  try {
    const encoded = toBase64(prepared.keys.root),
      backup = source.replica.exportBackup(encoded),
      before = target.persisted()
    assert.throws(() =>
      target.replica.restoreBackup(backup, toBase64(randomKey())),
    )
    const altered = clone(backup)
    altered.payload.ciphertext = altered.payload.ciphertext.replace(
      /^./,
      (c) => (c === 'A' ? 'B' : 'A'),
    )
    assert.throws(() => target.replica.restoreBackup(altered, encoded))
    assert.throws(
      () => partner.replica.restoreBackup(backup, encoded),
      /ROLE_MISMATCH/,
    )
    assert.deepEqual(target.persisted(), before)
    target.store.fail = true
    assert.throws(
      () => target.replica.restoreBackup(backup, encoded),
      /disk write/,
    )
    target.store.fail = false
    assert.deepEqual(target.persisted(), before)
    assert.equal(target.replica.state().profile, null)
    assert.equal(target.replica.status().identityUnlocked, false)
  } finally {
    engine.lock()
    source.replica.lockIdentity()
    target.replica.lockIdentity()
    partner.replica.lockIdentity()
  }
})
await test('backup recovery verifies an existing recovery key, changes master, rotates recovery and preserves ciphertext and identity', async () => {
  const source = empty(),
    target = empty()
  const { engine, prepared } = await source.setup()
  let recovered
  try {
    await engine.saveCredential(item('recovered'))
    const backup = source.replica.exportBackup(toBase64(prepared.keys.root)),
      payload = clone(source.replica.state().personal.payload),
      newMaster = 'Fictional replacement Windows master 456!'
    assert.throws(() =>
      recoverProfile(backup.accountId, backup.profile, 'invalid'),
    )
    const keys = recoverProfile(
      backup.accountId,
      backup.profile,
      prepared.recoveryCode,
    )
    try {
      const masterProfile = await rewrapMaster(
          backup.accountId,
          backup.profile,
          keys,
          newMaster,
          newMaster,
        ),
        replacement = rotateRecovery(backup.accountId, masterProfile, keys)
      target.replica.restoreBackup(
        backup,
        toBase64(keys.root),
        replacement.profile,
      )
      assert.throws(() =>
        recoverProfile(
          target.replica.id,
          target.replica.state().profile.data,
          prepared.recoveryCode,
        ),
      )
      const verified = recoverProfile(
        target.replica.id,
        target.replica.state().profile.data,
        replacement.recoveryCode,
      )
      destroyKeys(verified)
      await assert.rejects(() =>
        VaultEngine.unlock(target.api, target.replica.id, master),
      )
      target.replica.unlockIdentity(toBase64(keys.root))
      recovered = await VaultEngine.unlock(
        target.api,
        target.replica.id,
        newMaster,
      )
      assert.deepEqual(target.replica.state().personal.payload, payload)
      assert.equal(
        recovered.credentials[0].password,
        'Fictional-secret-recovered',
      )
    } finally {
      destroyKeys(keys)
    }
  } finally {
    engine.lock()
    recovered?.lock()
    source.replica.lockIdentity()
    target.replica.lockIdentity()
  }
})
await test('Personal conflict selection retains branches and current master/recovery wrappers; stale decisions fail', async () => {
  const left = empty()
  const { engine, prepared } = await left.setup()
  const right = empty('owner', left.persisted())
  let other
  try {
    right.replica.unlockIdentity(toBase64(prepared.keys.root))
    other = await VaultEngine.unlock(right.api, right.replica.id, master)
    await engine.saveCredential(item('left'))
    await other.saveCredential(item('right'))
    const changed = 'Fictional current master after fork 789!'
    await engine.changeMaster(master, changed, changed)
    const map = new Map(
      [
        ...left.replica.data.journal.personal,
        ...right.replica.data.journal.personal,
      ].map((p) => [JSON.stringify(p), p]),
    )
    left.replica.data.journal.personal = [...map.values()].map(clone)
    left.replica.data.conflicts.personal = left.replica.heads('personal')
    const versions = left.replica.conflictVersions('personal'),
      wrappers = clone(left.replica.state().profile.data)
    assert.equal(versions.length, 2)
    const beforeSharing = left.persisted()
    await assert.rejects(() => engine.createHousehold(), /SYNC_CONFLICT/)
    assert.deepEqual(left.persisted(), beforeSharing)
    const selected = versions.find(
      (v) =>
        JSON.stringify(v.snapshot.vault.payload) ===
        JSON.stringify(right.replica.state().personal.payload),
    )
    assert.throws(
      () => left.replica.resolveConflict('personal', selected.id, []),
      /CONFLICT_CHANGED/,
    )
    const count = left.replica.data.journal.personal.length
    left.replica.resolveConflict(
      'personal',
      selected.id,
      versions.map((v) => v.id),
    )
    assert.deepEqual(left.replica.state().profile.data, wrappers)
    assert.equal(left.replica.data.journal.personal.length, count + 1)
    assert.equal(left.replica.heads('personal').length, 1)
    await engine.refresh()
    assert.equal(engine.credentials[0].name, 'Fictional right')
    assert.ok(
      left.replica
        .historyVersions('personal')
        .some((v) => v.id !== selected.id),
    )
  } finally {
    engine.lock()
    other?.lock()
    left.replica.lockIdentity()
    right.replica.lockIdentity()
  }
})
await test('native clipboard clears its own text on expiry/lock and preserves unrelated clipboard content without exposing read-back', async () => {
  let value = 'Unrelated fictional clipboard'
  const clipboard = {
      readText: () => value,
      writeText: (text) => {
        value = text
      },
    },
    secret = new SecretClipboard(clipboard, 20)
  secret.copy('Fictional copied password')
  await new Promise((r) => setTimeout(r, 70))
  assert.equal(value, '')
  secret.copy('Fictional old copy')
  value = 'Unrelated new clipboard'
  secret.clear()
  assert.equal(value, 'Unrelated new clipboard')
  const local = empty()
  local.replica.onLocked = () => secret.clear()
  secret.copy('Fictional clear on lock')
  local.replica.lockIdentity()
  assert.equal(value, '')
  assert.throws(() => secret.copy({ bad: 'shape' }), /CLIPBOARD_INVALID/)
  let notified = false
  const blocked = new SecretClipboard(
    {
      writeText() {},
      readText() {
        throw new Error('Fictional clipboard unavailable')
      },
    },
    30000,
    () => {
      notified = true
    },
  )
  blocked.copy('Fictional blocked clipboard')
  assert.equal(blocked.clear(), false)
  assert.equal(notified, true)
})
await test('installer verifies its package, installs a new version and preserves previous versions; tampering/path escapes are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'lockbox-installer-'))
  assert.throws(
    () =>
      backupDestination(
        join(root, 'public', 'private.lockbox-backup'),
        join(root, 'application'),
      ),
    /PRIVATE_LOCATION/,
  )
  assert.throws(
    () =>
      backupDestination(
        join(root, 'application', 'private.lockbox-backup'),
        join(root, 'application'),
      ),
    /PRIVATE_LOCATION/,
  )
  assert.equal(
    backupDestination(
      join(root, 'private.lockbox-backup'),
      join(root, 'application'),
    ),
    join(root, 'private.lockbox-backup'),
  )
  try {
    const source = join(root, 'source'),
      programs = join(root, 'programs')
    mkdirSync(join(source, 'resources/app'), { recursive: true })
    writeFileSync(
      join(source, 'Lockbox.exe'),
      'Fictional executable fixture, never executed',
    )
    writeFileSync(join(source, 'resources/app/package.json'), '{}')
    const inventory = Object.fromEntries(
      ['Lockbox.exe', 'resources/app/package.json'].map((p) => [
        p,
        createHash('sha256')
          .update(readFileSync(join(source, p)))
          .digest('hex'),
      ]),
    )
    writeFileSync(join(source, 'SHA256SUMS.json'), JSON.stringify(inventory))
    const one = installFiles(source, programs),
      two = installFiles(source, programs)
    assert.notEqual(one, two)
    assert.equal(readFileSync(one, 'utf8'), readFileSync(two, 'utf8'))
    assert.equal(readdirSync(join(programs, 'LockboxPreview')).length, 2)
    writeFileSync(join(source, 'Lockbox.exe'), 'Fictional tamper')
    assert.throws(() => installFiles(source, programs), /INTEGRITY_FAILED/)
    inventory['../escape'] = '0'.repeat(64)
    writeFileSync(join(source, 'SHA256SUMS.json'), JSON.stringify(inventory))
    assert.throws(() => installFiles(source, programs), /INTEGRITY_FAILED/)
    assert.equal(readdirSync(join(programs, 'LockboxPreview')).length, 2)
  } finally {
    if (
      resolve(root).startsWith(resolve(tmpdir()) + sep) &&
      /^lockbox-installer-/.test(root.split(/[\\/]/).at(-1))
    )
      rmSync(root, { recursive: true, force: true })
  }
})
