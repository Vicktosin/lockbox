import assert from 'node:assert/strict'
import { test } from 'node:test'
import { privateDeploymentPlan } from '../server/maintenance/private-deployment.ts'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
  readdirSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  ensurePrivateDirectory,
  assertPrivate,
} from '../server/security/private-files.ts'
const parent = realpathSync.native(tmpdir()),
  root = join(parent, 'lockbox-private-plan-' + randomUUID())
ensurePrivateDirectory(root)
const host = 'lockbox-test.tail000000.ts.net',
  directory = join(root, 'plan')
const command = (args) =>
  spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      'scripts/prepare-private-deployment.mjs',
      ...args,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
try {
  await test('private profiles use HTTPS, production cookies/configuration and independent storage, service accounts, ingress and backend ports', () => {
    const staging = privateDeploymentPlan(host, 'staging'),
      household = privateDeploymentPlan(
        'lockbox.tail000000.ts.net',
        'household',
      )
    assert.equal(staging.origin, 'https://' + host)
    for (const key of [
      'service',
      'releaseRoot',
      'dataRoot',
      'configRoot',
      'ingressRoot',
      'backendPort',
      'ingressPort',
    ])
      assert.notEqual(staging[key], household[key], key)
    assert.match(staging.files['backend.env'], /^NODE_ENV=production\n/)
    assert.match(
      staging.files['lockbox-staging.service'],
      /User=lockbox-staging/,
    )
    assert.match(
      staging.files['lockbox-staging.service'],
      /ReadWritePaths=\/var\/lib\/lockbox-staging\n/,
    )
    assert.match(staging.files['lockbox-staging-ingress.service'], /User=caddy/)
    assert.equal(staging.googleConfigured, false)
    assert.equal(staging.deployed, false)
    assert.equal(staging.files['ingress.env'].includes('GOOGLE'), false)
    for (const bad of [
      'http://' + host,
      host + '/path',
      'localhost',
      '127.0.0.1',
      'other.example.com',
      host + '\nBad=setting',
    ])
      assert.throws(() => privateDeploymentPlan(bad, 'staging'))
    assert.throws(() => privateDeploymentPlan(host, 'other'))
  })
  await test('preparation writes private plan files only, verifies them and refuses to overwrite existing files or initialize a database', () => {
    const args = [
        '--hostname',
        host,
        '--profile',
        'staging',
        '--output',
        directory,
      ],
      result = command(args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).deployed, false)
    for (const file of readdirSync(directory))
      assertPrivate(join(directory, file), 'file')
    assert.equal(command(['--verify', directory]).status, 0)
    assert.notEqual(command(args).status, 0)
    assert.equal(readdirSync(root).length, 1)
    assert.equal(
      readdirSync(directory).some((name) => /sqlite|invitation|key/.test(name)),
      false,
    )
  })
  await test('modified backend or metadata plans fail verification rather than quietly deploying changed configuration', () => {
    writeFileSync(join(directory, 'backend.env'), 'NODE_ENV=development\n')
    assert.notEqual(command(['--verify', directory]).status, 0)
    const shell = readFileSync('deploy/install-private-linux.sh', 'utf8')
    assert.match(shell, /mountpoint -q/)
    assert.match(shell, /ext4\|xfs/)
    assert.equal(
      /systemctl\s+(?:start|enable)|tailscale\s+(?:serve|funnel)|mkfs|rm\s+-rf/.test(
        shell,
      ),
      false,
    )
  })
  await test('official Caddy validates private ingress; only loopback is bound, TLS/admin are not pretended and security headers match public configuration', () => {
    const tool = join(process.cwd(), 'server', '.data', 'phase7-tools'),
      binary = join(tool, 'caddy.exe'),
      proof = JSON.parse(
        readFileSync(join(tool, 'caddy-manifest.json'), 'utf8'),
      )
    assert.equal(
      createHash('sha256').update(readFileSync(binary)).digest('hex'),
      proof.binarySha256,
    )
    const result = spawnSync(
      binary,
      [
        'adapt',
        '--config',
        'deploy/Caddyfile.private',
        '--adapter',
        'caddyfile',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          LOCKBOX_PRIVATE_HTTP_PORT: '18081',
          LOCKBOX_PRIVATE_BACKEND_PORT: '18788',
          LOCKBOX_RELEASE_ROOT: process.cwd().replaceAll('\\', '/'),
        },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(result.stdout),
      server = Object.values(config.apps.http.servers)[0]
    assert.equal(config.admin.disabled, true)
    assert.deepEqual(server.listen, ['127.0.0.1:18081'])
    assert.equal(server.automatic_https.disable, true)
    const publicConfig = readFileSync('deploy/Caddyfile', 'utf8'),
      privateConfig = readFileSync('deploy/Caddyfile.private', 'utf8')
    for (const name of [
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Cache-Control',
      'X-Frame-Options',
      'Permissions-Policy',
      'Content-Security-Policy',
    ]) {
      const line = publicConfig
        .split('\n')
        .find((line) => line.trim().startsWith(name + ' '))
      assert.ok(line)
      assert.equal(privateConfig.includes(line), true, name)
    }
    assert.equal(privateConfig.includes('request delete'), true)
    const validate = spawnSync(
      binary,
      [
        'validate',
        '--config',
        'deploy/Caddyfile.private',
        '--adapter',
        'caddyfile',
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    assert.equal(validate.status, 0, validate.stderr)
  })
} finally {
  if (resolve(root).startsWith(resolve(parent) + sep))
    rmSync(root, { recursive: true, force: true })
}
