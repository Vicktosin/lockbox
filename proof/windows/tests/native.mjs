import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { join, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { VaultEngine } from '../../../src/features/vault/engine.ts'
import { hash } from '../native/identity.mjs'
import { FictionalGoogle } from './google-fixture.mjs'
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  parent = join(workspace, 'server', '.data'),
  root = join(parent, 'lockbox-native-proof-test-' + randomUUID()),
  releases = join(workspace, 'releases')
const packagePath = readdirSync(releases)
  .filter((name) => name.startsWith('LockboxProof-Windows-'))
  .sort()
  .at(-1)
assert.ok(packagePath, 'Build and package the isolated Windows proof first')
const executable = join(releases, packagePath, 'LockboxProof.exe'),
  google = new FictionalGoogle(),
  evidence = {
    runtime: 'packaged Electron',
    externalGoogle: 'NOT RUN',
    simulatedTransport: true,
    backendStopped: false,
    twoIndependentProcesses: false,
    peerStopped: false,
    household: false,
    conflict: false,
    osProtection: false,
    rendererBoot: false,
  }
if (process.env.LOCKBOX_PROOF_REQUIRE_BACKEND_STOPPED === '1') {
  let response = false
  try {
    await fetch('http://127.0.0.1:8787/healthz', {
      signal: AbortSignal.timeout(1000),
    })
    response = true
  } catch {
    /* Required: backend is unavailable. */
  }
  assert.equal(
    response,
    false,
    'Stop the existing backend through the maintainer-controlled rehearsal first',
  )
  evidence.backendStopped = true
}
class Installation {
  constructor(profile, role) {
    this.profile = profile
    this.id = 0
    this.pending = new Map()
    this.pipeName = 'lockbox-proof-' + randomUUID()
    this.pipeServer = createServer((channel) => {
      this.channel = channel
      createInterface({ input: channel }).on('line', (line) =>
        this.onLine(line),
      )
    })
    this.pipeServer.listen('\\\\.\\pipe\\' + this.pipeName)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    this.child = spawn(
      executable,
      [
        '--diagnostic',
        '--profile=' + profile,
        '--role=' + role,
        '--test-root=' + root,
        '--test-pipe=' + this.pipeName,
      ],
      {
        cwd: workspace,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    this.closed = new Promise((resolve) => this.child.once('exit', resolve))
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Packaged native proof did not become ready')),
        30000,
      )
      this.child.once('error', reject)
      this.child.once('exit', (code) =>
        reject(new Error('Packaged native proof exited before ready: ' + code)),
      )
      this.onReady = (value) => {
        clearTimeout(timer)
        resolve(value)
      }
    })
    this.child.stderr.resume()
    this.child.stdout.resume()
    this.onLine = (line) => {
      if (!line.startsWith('@@LOCKBOX@@')) return
      const message = JSON.parse(line.slice('@@LOCKBOX@@'.length))
      if (message.ready) {
        this.onReady(message)
        return
      }
      if (message.transport) {
        void google
          .fetch(message.url, message.options)
          .then(async (r) =>
            this.send({
              transport: message.transport,
              status: r.status,
              body: await r.json(),
            }),
          )
          .catch(() => this.send({ transport: message.transport, error: true }))
        return
      }
      const result = this.pending.get(message.id)
      if (!result) return
      this.pending.delete(message.id)
      clearTimeout(result.timer)
      if (message.ok) result.resolve(message.value)
      else result.reject(new Error(message.code))
    }
  }
  send(value) {
    this.channel.write(JSON.stringify(value) + '\n')
  }
  request(action, payload) {
    return new Promise((resolve, reject) => {
      const id = ++this.id,
        timer = setTimeout(
          () => reject(new Error('Native diagnostic command timed out')),
          60000,
        )
      this.pending.set(id, { resolve, reject, timer })
      this.send({ id, action, payload })
    })
  }
  api = (path, body) =>
    this.request('api', { path, ...(body === undefined ? {} : { body }) })
  async close() {
    if (this.child.exitCode !== null) return
    await this.request('close')
    await this.closed
    this.channel?.destroy()
    this.pipeServer.close()
  }
}
let a, b, ea, eb
const masterA = 'Fictional native process owner master!',
  masterB = 'Fictional native process partner master!',
  credential = (name, vault = 'shared') => ({
    name: 'Fictional ' + name,
    url: 'https://service.example.invalid',
    username: 'fictional@example.invalid',
    password: 'Fictional-native-process-secret-' + name,
    notes: 'Fictional native process note',
    category: 'Personal',
    vault,
    owner: 'emmanuel',
  })
try {
  await test('two packaged Windows processes start independently with actual OS-protected local stores and no Fastify dependency', async () => {
    a = new Installation('owner', 'owner')
    b = new Installation('partner', 'partner')
    const [ra, rb] = await Promise.all([a.ready, b.ready])
    assert.equal(ra.osEncryptionAvailable, true)
    assert.equal(rb.osEncryptionAvailable, true)
    assert.notEqual(a.child.pid, b.child.pid)
    evidence.twoIndependentProcesses = true
    evidence.osProtection = true
    const sa = await a.request('status'),
      sb = await b.request('status')
    const pa = await VaultEngine.prepare(sa.accountId, masterA, masterA),
      pb = await VaultEngine.prepare(sb.accountId, masterB, masterB)
    ea = await VaultEngine.finishSetup(a.api, sa.accountId, pa, pa.recoveryCode)
    eb = await VaultEngine.finishSetup(b.api, sb.accountId, pb, pb.recoveryCode)
    await ea.saveCredential(credential('native-owner-personal', 'personal'))
    await eb.saveCredential(credential('native-partner-personal', 'personal'))
    for (const profile of ['owner', 'partner']) {
      const bytes = readFileSync(
        join(root, profile, 'fictional-proof.sealed'),
      ).toString('utf8')
      for (const value of [masterA, masterB, 'Fictional-native-process-secret'])
        assert.equal(bytes.includes(value), false)
    }
  })
  await test('packaged processes independently share only authorized ciphertext through the simulated Google transport', async () => {
    await a.request('diagnostic-account', google.users.owner)
    await b.request('diagnostic-account', google.users.partner)
    await a.request('create-folders')
    await ea.createHousehold()
    const sa = await a.request('status'),
      sb = await b.request('status'),
      pairing = await b.request('pairing'),
      grant = await a.request('grant', {
        pairing,
        fingerprint: sb.fingerprint,
        householdCode: ea.exportHousehold(),
      })
    assert.equal(hash(pairing.body.identity), sb.fingerprint)
    await b.request('import-grant', {
      packet: grant,
      fingerprint: sa.fingerprint,
    })
    google.authorize('partner', [
      grant.body.folders.personal,
      grant.body.folders.shared,
    ])
    await b.request('sync')
    await eb.refresh()
    await eb.joinHousehold(await b.request('household-code'))
    await ea.saveCredential(credential('native-household'))
    await a.request('sync')
    await b.request('sync')
    await eb.refresh()
    assert.ok(
      eb.credentials.some((c) => c.name === 'Fictional native-household'),
    )
    assert.equal(
      eb.credentials.some((c) => c.name === 'Fictional native-owner-personal'),
      false,
    )
    evidence.household = true
  })
  await test('one packaged installation synchronizes and survives offline restart with the other installation actually stopped', async () => {
    await a.close()
    evidence.peerStopped = true
    google.offline.add('partner')
    await eb.saveCredential(credential('native-offline'))
    await assert.rejects(() => b.request('sync'), /NETWORK/)
    eb.lock()
    await b.close()
    b = new Installation('partner', 'partner')
    await b.ready
    const status = await b.request('status')
    eb = await VaultEngine.unlock(b.api, status.accountId, masterB)
    assert.ok(eb.credentials.some((c) => c.name === 'Fictional native-offline'))
    google.offline.delete('partner')
    await b.request('sync')
    a = new Installation('owner', 'owner')
    await a.ready
    const sa = await a.request('status')
    ea = await VaultEngine.unlock(a.api, sa.accountId, masterA)
    await a.request('sync')
    await ea.refresh()
    assert.ok(ea.credentials.some((c) => c.name === 'Fictional native-offline'))
  })
  await test('simultaneous packaged edits retain competing encrypted heads rather than overwriting a newer vault', async () => {
    await b.request('sync')
    await eb.refresh()
    await ea.saveCredential(credential('native-race-owner'))
    await eb.saveCredential(credential('native-race-partner'))
    await a.request('sync')
    await b.request('sync')
    await a.request('sync')
    const sa = await a.request('status'),
      sb = await b.request('status')
    assert.equal(sa.conflicts.household.length, 2)
    assert.equal(sb.conflicts.household.length, 2)
    await assert.rejects(
      () => ea.saveCredential(credential('should-not-overwrite')),
      /REVISION/,
    )
    evidence.conflict = true
  })
  await test('packaged sandboxed React renderer boots from bundled assets without an HTTP frontend or backend', async () => {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    const child = spawn(
      executable,
      [
        '--render-check',
        '--profile=renderer-check',
        '--role=owner',
        '--test-root=' + root,
      ],
      { cwd: workspace, env, windowsHide: true, stdio: 'ignore' },
    )
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Native React startup handshake timed out'))
      }, 45000)
      child.once('error', reject)
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    assert.equal(exit, 0)
    assert.equal(
      JSON.parse(
        readFileSync(
          join(root, 'renderer-check', 'renderer-ready.json'),
          'utf8',
        ),
      ).ready,
      true,
    )
    evidence.rendererBoot = true
  })
} finally {
  ea?.lock()
  eb?.lock()
  await a?.close()
  await b?.close()
  writeFileSync(
    join(workspace, 'docs', 'native-proof-results.json'),
    JSON.stringify(
      {
        ...evidence,
        completeLiveProofPassed: false,
        time: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )
  if (resolve(root).startsWith(resolve(parent) + sep))
    rmSync(root, { recursive: true, force: true })
}
