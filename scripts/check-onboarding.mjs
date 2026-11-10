import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { rmSync } from 'node:fs'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import { createBackendApp } from '../server/http/app.ts'
const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-onboarding-' + randomUUID()),
  path = join(root, 'db', 'test.sqlite'),
  origin = 'http://localhost:5173'
ensurePrivateDirectory(root)
initializeDatabase(path)
const db = openInitializedDatabase(path),
  app = createBackendApp(undefined, () => {}, {
    db,
    origin,
    production: false,
    vaults: true,
  })
const password = 'Fictional invitation validation passphrase!'
const call = (url, body, account, headers = {}) =>
  app.inject({
    url,
    method: body ? 'POST' : 'GET',
    headers: {
      origin,
      ...(account
        ? { cookie: account.cookie, 'x-csrf-token': account.csrf }
        : {}),
      ...headers,
    },
    ...(body ? { payload: body } : {}),
  })
async function register(username, inviteCode) {
  return call('/api/auth/register', {
    username,
    password,
    passwordConfirmation: password,
    inviteCode,
  })
}
async function login(username) {
  const r = await call('/api/auth/login', { username, password })
  assert.equal(r.statusCode, 200, r.body)
  return {
    cookie: String(r.headers['set-cookie']).split(';')[0],
    csrf: r.json().csrfToken,
    id: r.json().user.id,
  }
}
function cleanup() {
  if (!resolve(root).startsWith(resolve(parent) + sep))
    throw new Error('Unsafe cleanup')
  rmSync(root, { recursive: true, force: true })
}
let admin, member, invite
try {
  await test('member invitations require administrator session, current password, CSRF and strict role-free input', async () => {
    assert.equal(
      (
        await register(
          'OnboardingAdmin',
          issueRegistrationInvite(db, 'administrator').inviteCode,
        )
      ).statusCode,
      201,
    )
    admin = await login('OnboardingAdmin')
    assert.equal(
      (await call('/api/auth/invitations', { password })).statusCode,
      401,
    )
    assert.equal(
      (
        await call('/api/auth/invitations', { password }, admin, {
          'x-csrf-token': 'wrong',
        })
      ).statusCode,
      403,
    )
    assert.equal(
      (await call('/api/auth/invitations', { password: 'wrong' }, admin))
        .statusCode,
      401,
    )
    assert.equal(
      (
        await call(
          '/api/auth/invitations',
          { password, role: 'administrator' },
          admin,
        )
      ).statusCode,
      400,
    )
    const r = await call('/api/auth/invitations', { password }, admin)
    assert.equal(r.statusCode, 200, r.body)
    invite = r.json().inviteCode
  })
  await test('replacement invitation invalidates its predecessor and registration consumes only the new capability', async () => {
    const next = await call('/api/auth/invitations', { password }, admin)
    assert.equal(next.statusCode, 200, next.body)
    assert.equal((await register('OnboardingPartner', invite)).statusCode, 409)
    invite = next.json().inviteCode
    assert.equal((await register('OnboardingPartner', invite)).statusCode, 201)
    member = await login('OnboardingPartner')
    assert.equal((await register('ThirdAccount', invite)).statusCode, 409)
    assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 2)
  })
  await test('member cannot issue invitations and account registration never grants Personal or Household data', async () => {
    assert.equal(
      (await call('/api/auth/invitations', { password }, member)).statusCode,
      403,
    )
    assert.equal(
      (await call('/api/auth/invitations', { password }, admin)).statusCode,
      409,
    )
    const state = await call('/api/vault/state', null, member)
    assert.equal(state.statusCode, 200)
    assert.equal(state.json().personal, null)
    assert.equal(state.json().household, null)
    assert.equal(
      db.prepare('SELECT count(*) n FROM client_vault_members').get().n,
      0,
    )
    assert.ok(
      !JSON.stringify(
        db.prepare('SELECT token_digest FROM account_tokens').all(),
      ).includes(invite),
    )
  })
} finally {
  await app.close()
  db.close()
  cleanup()
}
