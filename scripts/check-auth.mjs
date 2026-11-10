import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, sep } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import * as argon2 from 'argon2'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { createBackendApp } from '../server/http/app.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import { sessionDigest } from '../server/auth/service.ts'
import { createLogger } from '../server/logging.ts'

const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-auth-test-' + randomUUID())
ensurePrivateDirectory(root)
const path = join(root, 'db', 'auth.sqlite')
initializeDatabase(path)
const db = openInitializedDatabase(path)
let time = Date.UTC(2026, 10, 9, 10)
const now = () => time,
  origin = 'http://localhost:5173',
  password = 'Fictional login passphrase 2026!'
const lines = [],
  log = createLogger('info', (line) => lines.push(line))
const options = { db, origin, production: false, now }
let app = createBackendApp(log, () => {}, options)
let first, second, adminId, memberId
const request = (method, url, body, extra = {}) =>
  app.inject({
    method,
    url,
    ...(body ? { payload: body } : {}),
    headers: {
      origin,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(extra.headers ?? {}),
    },
    ...(extra.ip ? { remoteAddress: extra.ip } : {}),
  })
const login = async (username = 'Primary', extra = {}) => {
  const response = await request(
    'POST',
    '/api/auth/login',
    { username, password },
    extra,
  )
  assert.equal(response.statusCode, 200, response.body)
  const cookie = String(response.headers['set-cookie']).split(';')[0]
  return {
    response,
    cookie,
    csrf: response.json().csrfToken,
    user: response.json().user,
  }
}
const headers = (session) => ({
  cookie: session.cookie,
  'x-csrf-token': session.csrf,
})
try {
  await test('registration requires operator invitation and confirmation; stores only a vetted hash', async () => {
    const invite = issueRegistrationInvite(db, 'administrator', time)
    const mismatch = await request('POST', '/api/auth/register', {
      username: 'Primary',
      password,
      passwordConfirmation: 'Different fictional passphrase!',
      inviteCode: invite.inviteCode,
    })
    assert.equal(mismatch.statusCode, 400)
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0)
    const response = await request('POST', '/api/auth/register', {
      username: ' Primary ',
      password,
      passwordConfirmation: password,
      inviteCode: invite.inviteCode,
    })
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.headers['set-cookie'], undefined)
    adminId = response.json().user.id
    assert.equal(response.json().user.username, 'Primary')
    assert.equal(response.json().user.role, 'administrator')
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(adminId)
    assert.notEqual(row.password_hash, password)
    assert.match(row.password_hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/)
    assert.ok(await argon2.verify(row.password_hash, password))
    assert.ok(
      !response.body.includes('password_hash') &&
        !response.body.includes(password),
    )
    const reused = await request('POST', '/api/auth/register', {
      username: 'Another',
      password,
      passwordConfirmation: password,
      inviteCode: invite.inviteCode,
    })
    assert.equal(reused.statusCode, 409)
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1)
  })
  await test('case-insensitive uniqueness is database-enforced; duplicate registration rolls back invite consumption', async () => {
    const invite = issueRegistrationInvite(db, 'member', time)
    const duplicate = await request('POST', '/api/auth/register', {
      username: 'pRiMaRy',
      password,
      passwordConfirmation: password,
      inviteCode: invite.inviteCode,
    })
    assert.equal(duplicate.statusCode, 409)
    assert.equal(
      db
        .prepare('SELECT consumed_at FROM account_tokens WHERE id=?')
        .get(invite.id).consumed_at,
      null,
    )
    time += 60 * 60 * 1000
    const response = await request('POST', '/api/auth/register', {
      username: 'Partner',
      password,
      passwordConfirmation: password,
      inviteCode: invite.inviteCode,
    })
    assert.equal(response.statusCode, 201, response.body)
    memberId = response.json().user.id
    assert.equal(response.json().user.role, 'member')
    assert.throws(() =>
      db
        .prepare(
          'UPDATE users SET username_display=?,username_canonical=? WHERE id=?',
        )
        .run('PRIMARY', 'primary', memberId),
    )
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 2)
    assert.throws(() => issueRegistrationInvite(db, 'member', time))
  })
  await test('validation rejects extra privileges, weak passwords, missing fields and untrusted origins', async () => {
    time += 60 * 60 * 1000
    for (const body of [
      { username: 'bad@email', password },
      { username: 'Primary', password, role: 'administrator' },
      {
        username: 'Primary',
        password,
        masterPassword: 'Must never be accepted',
      },
      { username: 'Primary' },
    ]) {
      assert.equal(
        (await request('POST', '/api/auth/login', body)).statusCode,
        400,
      )
    }
    const blocked = await request(
      'POST',
      '/api/auth/login',
      { username: 'Primary', password },
      { headers: { origin: 'https://untrusted.example' } },
    )
    assert.equal(blocked.statusCode, 403)
    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'Primary', password },
    })
    assert.equal(noOrigin.statusCode, 403)
    const weak = await request('POST', '/api/auth/register', {
      username: 'Other',
      password: 'short',
      passwordConfirmation: 'short',
      inviteCode: randomBytes(32).toString('base64url'),
    })
    assert.equal(weak.statusCode, 400)
  })
  await test('obsolete Argon2 parameters are upgraded without touching vault rows', async () => {
    const old = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    })
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(old, adminId)
    await login()
    const updated = db
      .prepare('SELECT password_hash FROM users WHERE id=?')
      .get(adminId).password_hash
    assert.notEqual(updated, old)
    assert.ok(
      !argon2.needsRehash(updated, {
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      }),
    )
    assert.ok(await argon2.verify(updated, password))
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM encrypted_payloads').get().n,
      0,
    )
  })
  await test('expired/replaced invitations fail and concurrent redemption creates exactly one account', async () => {
    const isolatedPath = join(root, 'races', 'races.sqlite')
    initializeDatabase(isolatedPath)
    const isolatedDb = openInitializedDatabase(isolatedPath)
    const isolatedApp = createBackendApp(log, () => {}, {
      ...options,
      db: isolatedDb,
    })
    const register = (inviteCode, username = 'FirstAdmin') =>
      isolatedApp.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { origin },
        payload: {
          username,
          password,
          passwordConfirmation: password,
          inviteCode,
        },
      })
    try {
      const expired = issueRegistrationInvite(
        isolatedDb,
        'administrator',
        time - 24 * 60 * 60 * 1000 - 1,
      )
      assert.equal((await register(expired.inviteCode)).statusCode, 409)
      const replaced = issueRegistrationInvite(
        isolatedDb,
        'administrator',
        time,
      )
      const current = issueRegistrationInvite(isolatedDb, 'administrator', time)
      assert.equal((await register(replaced.inviteCode)).statusCode, 409)
      const responses = await Promise.all([
        register(current.inviteCode),
        register(current.inviteCode, 'AnotherAdmin'),
      ])
      assert.deepEqual(
        responses.map((value) => value.statusCode).sort(),
        [201, 409],
      )
      assert.equal(
        isolatedDb.prepare('SELECT count(*) AS n FROM users').get().n,
        1,
      )
      assert.ok(
        isolatedDb
          .prepare('SELECT consumed_at FROM account_tokens WHERE id=?')
          .get(current.id).consumed_at,
      )
      assert.equal(isolatedDb.pragma('integrity_check', { simple: true }), 'ok')
    } finally {
      await isolatedApp.close()
      isolatedDb.close()
    }
  })
  await test('login is case-insensitive, cookie is HttpOnly and tokens never appear in JSON or database', async () => {
    first = await login('pRiMaRy', {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0' },
    })
    assert.equal(first.user.id, adminId)
    const cookie = String(first.response.headers['set-cookie'])
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Lax/i)
    assert.match(cookie, /Path=\//i)
    assert.ok(
      !/; Secure/i.test(cookie),
      'Only explicit loopback development uses a non-Secure cookie',
    )
    const raw = first.cookie.split('=')[1]
    assert.equal(raw.length, 43)
    assert.ok(!first.response.body.includes(raw))
    const stored = db
      .prepare('SELECT * FROM sessions WHERE token_digest=?')
      .get(sessionDigest(raw))
    assert.ok(stored)
    assert.equal(stored.token_digest.length, 32)
    assert.ok(!Object.values(stored).includes(raw))
    const me = await request('GET', '/api/auth/me', null, {
      headers: { cookie: first.cookie },
    })
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().user.username, 'Primary')
    assert.equal(me.json().csrfToken, first.csrf)
    assert.equal(me.headers['cache-control'], 'no-store')
    second = await login('Primary')
  })
  await test('unknown username and incorrect password return identical generic errors', async () => {
    const a = await request('POST', '/api/auth/login', {
      username: 'Primary',
      password: 'Wrong fictional login passphrase!',
    })
    const b = await request('POST', '/api/auth/login', {
      username: 'UnknownUser',
      password: 'Wrong fictional login passphrase!',
    })
    assert.equal(a.statusCode, 401)
    assert.equal(b.statusCode, 401)
    assert.deepEqual(a.json(), b.json())
    assert.deepEqual(a.json(), { code: 'INVALID_CREDENTIALS' })
  })
  await test('failed-login rate limiting applies to known and unknown canonical names and ignores spoofed forwarded IP', async () => {
    time += 15 * 60 * 1000
    for (let i = 0; i < 5; i++) {
      const response = await request('POST', '/api/auth/login', {
        username: 'UnknownRate',
        password: 'Incorrect fictional passphrase!',
      })
      assert.equal(response.statusCode, 401)
    }
    const limited = await request(
      'POST',
      '/api/auth/login',
      { username: 'UNKNOWNRATE', password: 'Incorrect fictional passphrase!' },
      { headers: { 'x-forwarded-for': '203.0.113.44' } },
    )
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.headers['retry-after']) > 0)
    time += 15 * 60 * 1000
    assert.equal(
      (
        await request('POST', '/api/auth/login', {
          username: 'unknownrate',
          password: 'Incorrect fictional passphrase!',
        })
      ).statusCode,
      401,
    )
    for (let i = 0; i < 29; i++)
      assert.equal(
        (
          await request('POST', '/api/auth/login', {
            username: 'UnknownIp' + i,
            password: 'Incorrect fictional passphrase!',
          })
        ).statusCode,
        401,
      )
    assert.equal(
      (
        await request(
          'POST',
          '/api/auth/login',
          {
            username: 'AnotherUnknown',
            password: 'Incorrect fictional passphrase!',
          },
          { headers: { 'x-forwarded-for': '198.51.100.1' } },
        )
      ).statusCode,
      429,
    )
    time += 15 * 60 * 1000
    first = await login()
    second = await login()
  })
  await test('sessions persist across app restart and listing is scoped to the signed-in user', async () => {
    await app.close()
    app = createBackendApp(log, () => {}, options)
    const me = await request('GET', '/api/auth/me', null, {
      headers: { cookie: first.cookie },
    })
    assert.equal(me.statusCode, 200)
    const member = await login('partner')
    const list = await request('GET', '/api/auth/sessions', null, {
      headers: { cookie: first.cookie },
    })
    assert.equal(list.statusCode, 200)
    assert.ok(list.json().sessions.length >= 2)
    assert.equal(list.json().sessions.filter((item) => item.current).length, 1)
    assert.ok(
      !list.body.includes('token_digest') &&
        !list.body.includes(member.cookie.split('=')[1]),
    )
    const memberList = await request('GET', '/api/auth/sessions', null, {
      headers: { cookie: member.cookie },
    })
    assert.equal(memberList.json().sessions.length, 1)
    const denied = await request(
      'POST',
      '/api/auth/sessions/' + memberList.json().sessions[0].id + '/revoke',
      null,
      { headers: headers(first) },
    )
    assert.equal(denied.statusCode, 404)
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: member.cookie },
        })
      ).statusCode,
      200,
    )
  })
  await test('CSRF is required for session mutation; revoke one, logout and logout-all invalidate server state', async () => {
    const bad = await request('POST', '/api/auth/logout', null, {
      headers: { cookie: first.cookie },
    })
    assert.equal(bad.statusCode, 403)
    const list = await request('GET', '/api/auth/sessions', null, {
      headers: { cookie: first.cookie },
    })
    const other = list.json().sessions.find((item) => !item.current)
    assert.equal(
      (
        await request(
          'POST',
          '/api/auth/sessions/' + other.id + '/revoke',
          null,
          { headers: headers(first) },
        )
      ).statusCode,
      204,
    )
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: second.cookie },
        })
      ).statusCode,
      401,
    )
    assert.equal(
      (
        await request('POST', '/api/auth/logout', null, {
          headers: headers(first),
        })
      ).statusCode,
      204,
    )
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: first.cookie },
        })
      ).statusCode,
      401,
    )
    first = await login()
    second = await login()
    assert.equal(
      (
        await request('POST', '/api/auth/logout-all', null, {
          headers: headers(first),
        })
      ).statusCode,
      204,
    )
    for (const session of [first, second])
      assert.equal(
        (
          await request('GET', '/api/auth/me', null, {
            headers: { cookie: session.cookie },
          })
        ).statusCode,
        401,
      )
  })
  await test('replacement login rotates cookie and revokes the browser previous session', async () => {
    first = await login()
    second = await login('Primary', { headers: { cookie: first.cookie } })
    assert.notEqual(first.cookie, second.cookie)
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: first.cookie },
        })
      ).statusCode,
      401,
    )
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: second.cookie },
        })
      ).statusCode,
      200,
    )
  })
  await test('idle and absolute expiry, inactive accounts and restore-required accounts fail server validation', async () => {
    first = await login()
    time += 30 * 60 * 1000
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: first.cookie },
        })
      ).statusCode,
      401,
    )
    first = await login()
    const start = time
    for (let i = 0; i < 23; i++) {
      time += 29 * 60 * 1000
      assert.equal(
        (
          await request('GET', '/api/auth/me', null, {
            headers: { cookie: first.cookie },
          })
        ).statusCode,
        200,
      )
    }
    time = start + 12 * 60 * 60 * 1000
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: first.cookie },
        })
      ).statusCode,
      401,
    )
    first = await login()
    db.prepare('UPDATE users SET active=0 WHERE id=?').run(adminId)
    assert.equal(
      (
        await request('GET', '/api/auth/me', null, {
          headers: { cookie: first.cookie },
        })
      ).statusCode,
      401,
    )
    db.prepare(
      'UPDATE users SET active=1,password_reset_required=1 WHERE id=?',
    ).run(adminId)
    assert.equal(
      (
        await request('POST', '/api/auth/login', {
          username: 'Primary',
          password,
        })
      ).statusCode,
      401,
    )
    db.prepare('UPDATE users SET password_reset_required=0 WHERE id=?').run(
      adminId,
    )
  })
  await test('production cookies are Secure and host-only, while recovery/vault/Drive remain inactive', async () => {
    await app.close()
    app = createBackendApp(log, () => {}, {
      ...options,
      origin: 'https://lockbox.example',
      production: true,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://lockbox.example' },
      payload: { username: 'Primary', password },
    })
    assert.equal(response.statusCode, 200)
    const cookie = String(response.headers['set-cookie'])
    assert.match(cookie, /^__Host-lockbox_session=/)
    assert.match(cookie, /; Secure/i)
    assert.match(cookie, /HttpOnly/i)
    assert.ok(!/Domain=/i.test(cookie))
    for (const url of [
      '/api/auth/reset',
      '/api/auth/forgot-password',
      '/api/credentials',
      '/api/v1/vaults',
      '/api/admin/google-drive/connect',
    ])
      assert.equal((await app.inject({ method: 'POST', url })).statusCode, 503)
    assert.equal(db.prepare('SELECT count(*) AS n FROM credentials').get().n, 0)
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM encryption_key_checks').get().n,
      0,
    )
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    assert.ok(!lines.join('').includes(password))
    assert.ok(!lines.join('').includes(first.cookie.split('=')[1]))
  })
} finally {
  await app.close()
  db.close()
  assert.ok(
    resolve(root).startsWith(resolve(parent) + sep) &&
      root.includes('lockbox-auth-test-'),
  )
  rmSync(root, { recursive: true, force: true })
}
