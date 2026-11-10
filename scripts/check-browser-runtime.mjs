// Real Chromium/Edge runtime tests against a developer diagnostic page, not UI automation.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID, randomBytes } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { createServer as createVite } from 'vite'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../server/database/migrations.ts'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { initializeKeyFile, loadKeyFile } from '../server/security/key-file.ts'
import { issueRegistrationInvite } from '../server/auth/invitations.ts'
import { createBackendApp } from '../server/http/app.ts'
const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-browser-runtime-' + randomUUID()),
  originState = {},
  results = [],
  bodies = [],
  running = []
ensurePrivateDirectory(root)
const dbPath = join(root, 'db', 'app.sqlite'),
  keyFile = join(root, 'keys', 'app.json')
initializeDatabase(dbPath)
const db = openInitializedDatabase(dbPath)
initializeKeyFile(db, keyFile)
const invite = issueRegistrationInvite(db, 'administrator').inviteCode,
  capabilities = {
    administrator: randomBytes(32).toString('base64url'),
    member: randomBytes(32).toString('base64url'),
  },
  drops = new Set()
let backend,
  vite,
  server,
  clock = Date.now(),
  origin
const binaries = {
  administrator: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  member: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
function cleanup() {
  if (!resolve(root).startsWith(resolve(parent) + sep))
    throw new Error('Unsafe cleanup')
  rmSync(root, { recursive: true, force: true })
}
async function jsonBody(req) {
  const chunks = []
  let n = 0
  for await (const c of req) {
    n += c.length
    if (n > 8192) throw new Error('Diagnostic body too large')
    chunks.push(c)
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}')
}
const send = (res, value, status = 200) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(value))
}
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.next = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const d = JSON.parse(event.data)
      if (d.id && this.pending.has(d.id)) {
        const p = this.pending.get(d.id)
        this.pending.delete(d.id)
        if (d.error) p.reject(new Error('Diagnostic protocol failed'))
        else p.resolve(d.result)
      }
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new Cdp(ws)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Diagnostic protocol timeout'))
      }, 10000)
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      )
    })
  }
  async value(expression) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      this.session,
    )
    return r.result?.value
  }
  async close() {
    await this.send('Browser.close').catch(() => {})
    this.ws.close()
  }
}
async function start(role, phase) {
  const profile = join(root, 'profiles', role)
  ensurePrivateDirectory(profile)
  const portFile = join(profile, 'DevToolsActivePort')
  if (existsSync(portFile)) rmSync(portFile)
  const child = spawn(
    binaries[role],
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      origin +
        '/__runtime/diagnostic?role=' +
        role +
        '&phase=' +
        phase +
        '#' +
        capabilities[role],
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
  )
  const item = { child, role, phase }
  running.push(item)
  const deadline = Date.now() + 90000
  while (
    !existsSync(portFile) &&
    Date.now() < deadline &&
    child.exitCode === null
  )
    await pause(100)
  assert.ok(existsSync(portFile), role + ' diagnostic browser did not start')
  const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
  item.cdp = await Cdp.connect('ws://127.0.0.1:' + port + path)
  const targets = await item.cdp.send('Target.getTargets')
  const target = targets.targetInfos.find(
    (x) =>
      x.type === 'page' && x.url.startsWith(origin + '/__runtime/diagnostic'),
  )
  assert.ok(target, 'No private diagnostic target')
  item.cdp.session = (
    await item.cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
  ).sessionId
  return item
}
async function stop(item) {
  if (item.child.exitCode !== null) return
  const exit = new Promise((r) => item.child.once('exit', r))
  await item.cdp?.close()
  await Promise.race([exit, pause(10000)])
  if (item.child.exitCode === null) {
    item.child.kill()
    await exit
  }
}
async function waitResults(phase, clients) {
  const deadline = Date.now() + 180000
  let transferred = false
  while (Date.now() < deadline) {
    if (phase === 'initial' && !transferred) {
      const card = await clients[0].cdp
        .value('globalThis.__runtimeTransfer')
        .catch(() => null)
      if (card) {
        await clients[1].cdp.value(
          'globalThis.__runtimeHouseholdKey=' + JSON.stringify(card),
        )
        await clients[0].cdp.value('globalThis.__runtimeTransfer=null')
        transferred = true
      }
    }
    const done = results.filter((x) => x.phase === phase)
    if (done.some((x) => !x.ok))
      throw new Error(
        'Browser diagnostic failed: ' +
          done
            .filter((x) => !x.ok)
            .map((x) => x.role + ':' + x.failedStep)
            .join(','),
      )
    if (done.length === 2) return done
    await pause(200)
  }
  throw new Error('Browser diagnostic deadline exceeded')
}
try {
  await test('real Chrome and Edge run isolated worker/crypto/account/Household/concurrency/network diagnostics', async () => {
    for (const file of Object.values(binaries))
      assert.ok(existsSync(file), 'Required developer browser is not installed')
    vite = await createVite({
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'custom',
    })
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, origin)
        if (url.pathname === '/__runtime/diagnostic') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store',
            'Content-Security-Policy':
              "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          })
          res.end(
            '<!doctype html><title>Lockbox developer runtime diagnostic</title><p>Running synthetic runtime tests.</p><script type="module" src="/scripts/browser-runtime/client.mjs"></script>',
          )
          return
        }
        if (url.pathname.startsWith('/__runtime/')) {
          const role = url.searchParams.get('role')
          if (
            !['administrator', 'member'].includes(role) ||
            req.headers['x-runtime-capability'] !== capabilities[role]
          ) {
            send(res, {}, 403)
            return
          }
          if (url.pathname.endsWith('/config'))
            send(res, {
              invite: role === 'administrator' ? invite : null,
              otherId:
                db
                  .prepare('SELECT id FROM users WHERE role<>? LIMIT 1')
                  .get(role)?.id ?? randomUUID(),
            })
          else if (url.pathname.endsWith('/drop')) {
            drops.add(role)
            send(res, {})
          } else if (url.pathname.endsWith('/online')) {
            drops.delete(role)
            send(res, {})
          } else if (url.pathname.endsWith('/result')) {
            results.push({ ...(await jsonBody(req)), role })
            send(res, {})
          } else {
            if (req.method === 'POST')
              Object.assign(originState, await jsonBody(req))
            if (
              originState.administratorReopened &&
              originState.memberReopened &&
              !originState.expire
            ) {
              clock += 31 * 60000
              originState.expire = true
            }
            send(res, originState)
          }
          return
        }
        if (url.pathname.startsWith('/api/')) {
          if (
            drops.has(req.headers['x-runtime-client']) &&
            req.method === 'POST' &&
            url.pathname.startsWith('/api/vault/')
          ) {
            req.socket.destroy()
            return
          }
          const chunks = []
          for await (const c of req) chunks.push(c)
          const body = Buffer.concat(chunks)
          if (body.length) bodies.push(body.toString())
          const r = await backend.inject({
            method: req.method,
            url: req.url,
            headers: req.headers,
            ...(body.length ? { payload: body } : {}),
          })
          res.writeHead(r.statusCode, r.headers)
          res.end(r.rawPayload)
          return
        }
        vite.middlewares(req, res, () => {
          res.writeHead(404)
          res.end()
        })
      } catch {
        send(res, { error: 'Diagnostic request failed' }, 500)
      }
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    origin = 'http://127.0.0.1:' + server.address().port
    backend = createBackendApp(undefined, () => {}, {
      db,
      origin,
      production: false,
      now: () => clock,
      vaults: true,
      drive: {
        keys: loadKeyFile(keyFile),
        application: null,
        background: false,
      },
      maintenance: {
        config: {
          dbPath,
          keyFile,
          backupDirectory: join(root, 'backups'),
          origin,
        },
        background: false,
        now: () => clock,
      },
    })
    await backend.ready()
    const clients = []
    try {
      clients.push(await start('administrator', 'initial'))
      clients.push(await start('member', 'initial'))
      const done = await waitResults('initial', clients)
      for (const result of done) {
        assert.ok(result.workerCount >= 3)
        assert.ok(result.checks.length >= 12)
      }
      assert.equal(
        Number(!!originState.administratorConflict) +
          Number(!!originState.memberConflict),
        1,
      )
    } finally {
      for (const child of clients) await stop(child)
    }
  })
  await test('independent browser profiles persist cookies, require fresh unlock, reject expired sessions and revoke logout', async () => {
    const clients = [
      await start('administrator', 'reopen'),
      await start('member', 'reopen'),
    ]
    const done = await waitResults('reopen', clients)
    for (const r of done)
      assert.ok(
        r.checks.includes(
          'browser cookie survives graceful closure and reopening',
        ),
      )
    for (const child of clients) await stop(child)
  })
  await test('browser-originated API/SQLite traffic contains no master passwords, plaintext vault contents or persistent key storage', () => {
    assert.equal(
      results.filter((x) => x.ok).length,
      4,
      'Both browser phases must pass before writing a successful runtime report',
    )
    const wire = bodies.join('\n'),
      vaultRows = JSON.stringify(
        db.prepare('SELECT * FROM client_vaults').all(),
      )
    assert.ok(!wire.includes('Fictional independent browser master'))
    assert.ok(!wire.includes('FICTIONAL-BROWSER-SAVED-'))
    assert.ok(!wire.includes('FICTIONAL-BROWSER-EDITED-'))
    assert.ok(!vaultRows.includes('FICTIONAL-BROWSER-'))
    assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 2)
    const report = {
      kind: 'real-browser-runtime-not-ui-acceptance',
      time: new Date().toISOString(),
      liveGoogle: 'not-run-no-registration',
      physicalDevices: 'not-tested',
      results: results.map(
        ({ role, phase, ok, checks, workerCount, userAgent }) => ({
          role,
          phase,
          ok,
          checks,
          workerCount,
          userAgent,
        }),
      ),
    }
    writeFileSync(
      'docs/phase7-browser-runtime-results.json',
      JSON.stringify(report, null, 2) + '\n',
    )
  })
} finally {
  for (const item of running) await stop(item)
  await backend?.close()
  if (server) await new Promise((r) => server.close(r))
  await vite?.close()
  db.close()
  cleanup()
}
