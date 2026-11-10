import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import https from 'node:https'
import { createBackendApp } from '../server/http/app.ts'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import {
  initializeKeyFile,
  loadKeyFile,
  verifyDatabaseKeys,
} from '../server/security/key-file.ts'
import {
  ensurePrivateDirectory,
  assertPrivate,
} from '../server/security/private-files.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import { loadFoundationConfig } from '../server/config/foundation.ts'

const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-deploy-rehearsal-' + randomUUID())
ensurePrivateDirectory(root)
const dbPath = join(root, 'db', 'app.sqlite'),
  keyFile = join(root, 'keys', 'app.json'),
  certFile = join(root, 'cert.pem'),
  privateFile = join(root, 'tls-key.pem')
const openssl =
  process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
    : 'openssl'
let backend, tls, db, origin
const cleanup = () => {
  if (!resolve(root).startsWith(resolve(parent) + sep))
    throw new Error('Unsafe cleanup')
  rmSync(root, { recursive: true, force: true })
}
function request(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      origin + path,
      {
        method: body ? 'POST' : 'GET',
        ca: readFileSync(certFile),
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (response) => {
        let data = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (data += chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: data,
          }),
        )
      },
    )
    r.on('error', reject)
    r.end(body ? JSON.stringify(body) : undefined)
  })
}
try {
  await test('private deployment rehearsal creates a temporary trusted loopback TLS endpoint without public binding', async () => {
    if (process.platform === 'win32')
      assert.ok(
        existsSync(openssl),
        'Git OpenSSL is required for this developer-only TLS rehearsal',
      )
    const generated = spawnSync(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        privateFile,
        '-out',
        certFile,
      ],
      { stdio: 'pipe', windowsHide: true },
    )
    assert.equal(generated.status, 0, 'Ephemeral certificate generation failed')
    assertPrivate(privateFile, 'file')
    const template = readFileSync('deploy/Caddyfile', 'utf8'),
      headers = {}
    for (const line of template.split('\n')) {
      const match = /^\s+([A-Za-z-]+) "(.*)"\s*$/.exec(line)
      if (match) headers[match[1]] = match[2]
    }
    tls = https.createServer(
      { key: readFileSync(privateFile), cert: readFileSync(certFile) },
      async (req, res) => {
        for (const [key, value] of Object.entries(headers))
          res.setHeader(key, value)
        if (req.url.startsWith('/api/') || req.url === '/healthz') {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const r = await backend.inject({
            method: req.method,
            url: req.url,
            headers: req.headers,
            payload: Buffer.concat(chunks),
          })
          res.writeHead(r.statusCode, {
            ...Object.fromEntries(
              Object.entries(r.headers).filter(
                ([k]) => k !== 'transfer-encoding',
              ),
            ),
            ...headers,
          })
          res.end(r.body)
        } else {
          res.setHeader('Content-Type', 'text/html')
          res.end('<!doctype html><title>Private deployment rehearsal</title>')
        }
      },
    )
    await new Promise((r) => tls.listen(0, '127.0.0.1', r))
    origin = 'https://127.0.0.1:' + tls.address().port
    initializeDatabase(dbPath)
    db = openInitializedDatabase(dbPath)
    initializeKeyFile(db, keyFile)
    backend = createBackendApp(
      undefined,
      () => verifyDatabaseKeys(db, loadKeyFile(keyFile)),
      { db, origin, production: true, vaults: true },
    )
    await backend.ready()
    assert.equal((await request('/healthz')).status, 200)
  })
  await test('HTTPS response uses the configured CSP/security headers and secure host-only authentication cookies', async () => {
    const page = await request('/')
    assert.match(
      page.headers['content-security-policy'],
      /frame-ancestors 'none'/,
    )
    assert.match(page.headers['content-security-policy'], /'wasm-unsafe-eval'/)
    assert.match(page.headers['strict-transport-security'], /31536000/)
    assert.equal(page.headers['cache-control'], 'no-store')
    const pass = 'Fictional deployment rehearsal passphrase!',
      invite = issueRegistrationInvite(db, 'administrator')
    assert.equal(
      (
        await request(
          '/api/auth/register',
          {
            username: 'DeployRehearsal',
            password: pass,
            passwordConfirmation: pass,
            inviteCode: invite.inviteCode,
          },
          { origin },
        )
      ).status,
      201,
    )
    const login = await request(
      '/api/auth/login',
      { username: 'deployrehearsal', password: pass },
      { origin },
    )
    assert.equal(login.status, 200)
    const cookie = login.headers['set-cookie'][0]
    assert.match(cookie, /^__Host-lockbox_session=/)
    assert.match(cookie, /; Secure/)
    assert.match(cookie, /; HttpOnly/)
    assert.match(cookie, /; SameSite=Lax/)
    assert.ok(!cookie.includes('Domain='))
    assert.equal(
      (await request('/api/auth/me', null, { cookie: cookie.split(';')[0] }))
        .status,
      200,
    )
    assert.equal(
      (
        await request(
          '/api/auth/logout',
          {},
          {
            cookie: cookie.split(';')[0],
            origin: 'https://attacker.invalid',
            'x-csrf-token': JSON.parse(login.body).csrfToken,
          },
        )
      ).status,
      403,
    )
  })
  await test('database/key permissions, HTTPS validation and graceful shutdown fail closed', async () => {
    assertPrivate(dbPath, 'file')
    assertPrivate(keyFile, 'file')
    assert.throws(() =>
      loadFoundationConfig({
        NODE_ENV: 'production',
        LOCKBOX_APP_ORIGIN: 'http://example.test',
        LOCKBOX_DB_PATH: 'C:\\private\\db\\test.sqlite',
        LOCKBOX_KEY_FILE: 'C:\\private\\keys\\server.json',
        LOCKBOX_BACKUP_DIR: 'C:\\private\\backups',
      }),
    )
    await backend.close()
    backend = null
    await new Promise((r) => tls.close(r))
    tls = null
    await assert.rejects(request('/healthz'))
  })
} finally {
  await backend?.close()
  if (tls) await new Promise((r) => tls.close(r))
  db?.close()
  cleanup()
}
