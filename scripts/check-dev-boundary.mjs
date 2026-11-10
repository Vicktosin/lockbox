import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { ensurePrivateDirectory } from '../server/security/private-files.ts'
import { writePrivateNew } from '../server/security/key-file.ts'
const parent = join(process.cwd(), 'server', '.data'),
  root = join(parent, 'lockbox-dev-boundary-' + randomUUID()),
  canary = 'FICTIONAL-DEV-CANARY-NOT-A-SECRET'
ensurePrivateDirectory(root)
writePrivateNew(join(root, 'canary.json'), JSON.stringify({ canary }))
let baseline, guarded
function cleanup() {
  if (!resolve(root).startsWith(resolve(parent) + sep))
    throw new Error('Unsafe cleanup')
  rmSync(root, { recursive: true, force: true })
}
try {
  await test('previous Vite default filesystem policy can expose a nonsecret backend-tree canary', async () => {
    baseline = await createServer({
      configFile: false,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    })
    await baseline.listen()
    const r = await fetch(
      'http://127.0.0.1:' +
        baseline.httpServer.address().port +
        '/server/.data/' +
        root.split(/[\\/]/).at(-1) +
        '/canary.json',
    )
    assert.equal(r.status, 200)
    assert.ok((await r.text()).includes(canary))
    await baseline.close()
    baseline = null
  })
  await test('application configuration denies backend files, raw filesystem variants and environment files', async () => {
    guarded = await createServer({
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    })
    await guarded.listen()
    const base = 'http://127.0.0.1:' + guarded.httpServer.address().port
    for (const path of [
      '/server/.data/' + root.split(/[\\/]/).at(-1) + '/canary.json',
      '/@fs/' +
        encodeURI(join(root, 'canary.json').replaceAll('\\', '/')) +
        '?raw',
      '/server/auth/service.ts?raw',
      '/server/.env.example?raw',
    ]) {
      const r = await fetch(base + path)
      const body = await r.text()
      assert.ok([403, 404].includes(r.status), path + ' status ' + r.status)
      assert.ok(!body.includes(canary))
    }
    assert.equal((await fetch(base + '/src/main.tsx')).status, 200)
  })
} finally {
  await baseline?.close()
  await guarded?.close()
  cleanup()
}
