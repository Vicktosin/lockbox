import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import https from 'node:https'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import {
  writePrivateNew,
  initializeKeyFile,
  loadKeyFile,
  verifyDatabaseKeys,
} from '../server/security/key-file.ts'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import { createBackendApp } from '../server/http/app.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-caddy-' + randomUUID()),
  toolRoot = join(parent, 'phase7-tools'),
  binary = join(toolRoot, 'caddy.exe'),
  proof = JSON.parse(
    readFileSync(join(toolRoot, 'caddy-manifest.json'), 'utf8'),
  )
assert.equal(
  createHash('sha256').update(readFileSync(binary)).digest('hex'),
  proof.binarySha256,
  'Portable executable must match verified publisher artifact',
)
ensurePrivateDirectory(root)
const env = {
    ...process.env,
    LOCKBOX_HOST: 'lockbox.invalid',
    XDG_DATA_HOME: join(root, 'caddy-data'),
    XDG_CONFIG_HOME: join(root, 'caddy-config'),
  },
  cert = join(root, 'cert.pem'),
  key = join(root, 'key.pem'),
  dbPath = join(root, 'db', 'app.sqlite'),
  serverKey = join(root, 'keys', 'app.json')
let caddy,
  backend,
  db,
  origin,
  adminPort,
  logs = ''
const evidence = {
  caddyVersion: proof.version,
  publicExposure: false,
  productionCaddyfile: 'not-run',
  privateTls: 'not-run',
  authHeaders: 'not-run',
  errorLogRedaction: 'not-run',
  gracefulStop: 'not-run',
  systemd: 'not-run-windows-host',
}
async function freePort() {
  const server = net.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const p = server.address().port
  await new Promise((r) => server.close(r))
  return p
}
function command(args) {
  return spawnSync(binary, args, { env, stdio: 'pipe', windowsHide: true })
}
function cleanup() {
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
        ca: readFileSync(cert),
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        const parts = []
        res.on('data', (p) => parts.push(p))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(parts).toString(),
          }),
        )
      },
    )
    r.on('error', reject)
    r.end(body ? JSON.stringify(body) : undefined)
  })
}
try {
  await test('official Caddy adapts the existing production configuration and validates its private rehearsal counterpart', async () => {
    const adapted = command([
      'adapt',
      '--adapter',
      'caddyfile',
      '--config',
      'deploy/Caddyfile',
    ])
    assert.equal(
      adapted.status,
      0,
      'Production Caddyfile adaptation failed: ' +
        adapted.stderr.toString().slice(0, 250),
    )
    JSON.parse(adapted.stdout.toString())
    evidence.productionCaddyfile = 'adapted-by-real-caddy'
    const certificate = spawnSync(
      'C:/Program Files/Git/usr/bin/openssl.exe',
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
        key,
        '-out',
        cert,
      ],
      { stdio: 'pipe', windowsHide: true },
    )
    assert.equal(certificate.status, 0)
    const tlsPort = await freePort()
    adminPort = await freePort()
    origin = 'https://127.0.0.1:' + tlsPort
    initializeDatabase(dbPath)
    db = openInitializedDatabase(dbPath)
    initializeKeyFile(db, serverKey)
    backend = createBackendApp(
      undefined,
      () => verifyDatabaseKeys(db, loadKeyFile(serverKey)),
      { db, origin, production: true, vaults: true },
    )
    await backend.listen({ host: '127.0.0.1', port: 0 })
    const normalize = (p) => p.replaceAll('\\', '/'),
      backendPort = backend.server.address().port
    const template = readFileSync('deploy/Caddyfile', 'utf8').replaceAll(
      '\r\n',
      '\n',
    )
    const privateConfig = template
      .replace(
        '\n{\n',
        '\n{\n admin 127.0.0.1:' + adminPort + '\n auto_https off\n',
      )
      .replace(
        '{$LOCKBOX_HOST} {',
        origin +
          ' {\n bind 127.0.0.1\n tls "' +
          normalize(cert) +
          '" "' +
          normalize(key) +
          '"',
      )
      .replace(
        '/opt/lockbox/dist',
        '"' + normalize(join(process.cwd(), 'dist')) + '"',
      )
      .replace('127.0.0.1:8787', '127.0.0.1:' + backendPort)
    const path = join(root, 'Caddyfile')
    writePrivateNew(path, privateConfig)
    const valid = command([
      'validate',
      '--adapter',
      'caddyfile',
      '--config',
      path,
    ])
    assert.equal(
      valid.status,
      0,
      'Private Caddy validation failed: ' +
        valid.stderr.toString().slice(0, 350),
    )
    const config = JSON.parse(
      command([
        'adapt',
        '--adapter',
        'caddyfile',
        '--config',
        path,
      ]).stdout.toString(),
    )
    for (const server of Object.values(config.apps.http.servers))
      for (const address of server.listen)
        assert.match(
          address,
          /^127\.0\.0\.1:/,
          'Rehearsal must never bind publicly',
        )
    caddy = spawn(binary, ['run', '--adapter', 'caddyfile', '--config', path], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    caddy.stdout.on('data', (b) => (logs += b))
    caddy.stderr.on('data', (b) => (logs += b))
    const deadline = Date.now() + 20000
    let ready = false
    while (Date.now() < deadline && caddy.exitCode === null) {
      try {
        if ((await request('/healthz')).status === 200) {
          ready = true
          break
        }
      } catch {
        /* Wait for private TLS startup. */
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.ok(ready, 'Caddy did not become healthy: ' + logs.slice(-400))
    evidence.privateTls = 'passed-with-trusted-ephemeral-test-certificate'
  })
  await test('real Caddy serves static headers, proxies secure authentication and enforces API origin restrictions', async () => {
    const page = await request('/')
    assert.equal(page.status, 200)
    assert.match(
      page.headers['content-security-policy'],
      /frame-ancestors 'none'/,
    )
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.match(page.headers['strict-transport-security'], /31536000/)
    const password = 'Fictional actual Caddy validation passphrase!',
      invite = issueRegistrationInvite(db, 'administrator')
    assert.equal(
      (
        await request(
          '/api/auth/register',
          {
            username: 'CaddyAdmin',
            password,
            passwordConfirmation: password,
            inviteCode: invite.inviteCode,
          },
          { origin },
        )
      ).status,
      201,
    )
    const login = await request(
      '/api/auth/login',
      { username: 'caddyadmin', password },
      { origin },
    )
    assert.equal(login.status, 200)
    const cookie = login.headers['set-cookie'][0]
    assert.match(cookie, /^__Host-lockbox_session=/)
    assert.match(cookie, /; Secure/)
    assert.match(cookie, /; HttpOnly/)
    assert.match(cookie, /; SameSite=Lax/)
    assert.equal(login.headers['access-control-allow-origin'], undefined)
    assert.equal(
      (
        await request(
          '/api/auth/logout',
          {},
          {
            origin: 'https://attacker.invalid',
            cookie: cookie.split(';')[0],
            'x-csrf-token': JSON.parse(login.body).csrfToken,
          },
        )
      ).status,
      403,
    )
    evidence.authHeaders = 'passed-secure-cookie-csp-no-cors-origin-rejection'
  })
  await test('Caddy error logs omit callback query codes and request headers when the upstream is unavailable', async () => {
    await backend.close()
    backend = null
    const canary = 'SYNTHETIC_CALLBACK_CODE_NOT_A_REAL_TOKEN',
      r = await request(
        '/api/drive/callback?code=' + canary + '&state=' + canary,
        null,
        { Cookie: 'SYNTHETIC_SESSION_NOT_A_REAL_COOKIE' },
      )
    assert.equal(r.status, 502)
    await new Promise((r) => setTimeout(r, 300))
    assert.ok(!logs.includes(canary))
    assert.ok(!logs.includes('SYNTHETIC_SESSION_NOT_A_REAL_COOKIE'))
    assert.ok(logs.includes('error'))
    evidence.errorLogRedaction = 'passed-on-real-upstream-failure'
  })
  await test('private Caddy shuts down gracefully through its loopback-only administration endpoint', async () => {
    const exit = new Promise((r) => caddy.once('exit', r))
    const adminOrigin = 'http://127.0.0.1:' + adminPort
    const stopped = await fetch(adminOrigin + '/stop', {
      method: 'POST',
      headers: { Origin: adminOrigin, 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.ok(
      stopped.ok,
      'Caddy stop rejected ' + stopped.status + ' ' + (await stopped.text()),
    )
    await exit
    assert.equal(caddy.exitCode, 0)
    evidence.gracefulStop = 'passed'
    writeFileSync(
      'docs/phase7-caddy-results.json',
      JSON.stringify({ ...evidence, time: new Date().toISOString() }, null, 2) +
        '\n',
    )
  })
} finally {
  if (caddy?.exitCode === null) {
    const exit = new Promise((r) => caddy.once('exit', r))
    caddy.kill()
    await exit
  }
  await backend?.close()
  db?.close()
  cleanup()
}
