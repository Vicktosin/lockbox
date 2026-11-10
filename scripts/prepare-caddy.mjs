// Maintainer validation tool only. No service/global dependency/OS certificate installation.
import { createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  ensurePrivateDirectory,
  assertPrivate,
} from '../server/security/private-files.ts'
import { writePrivateNew } from '../server/security/key-file.ts'
const root = join(process.cwd(), 'server', '.data', 'phase7-tools')
ensurePrivateDirectory(root)
const binary = join(root, 'caddy.exe'),
  manifest = join(root, 'caddy-manifest.json')
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error(
    'This portable tool preparation targets the current Windows x64 developer host',
  )
if (existsSync(binary)) {
  assertPrivate(binary, 'file')
  const m = JSON.parse(readFileSync(manifest, 'utf8'))
  if (
    createHash('sha256').update(readFileSync(binary)).digest('hex') !==
    m.binarySha256
  )
    throw new Error('Existing tool checksum mismatch')
  process.stdout.write(
    'Existing official portable Caddy verified: ' + m.version + '\n',
  )
} else {
  const metadata = await fetch(
    'https://api.github.com/repos/caddyserver/caddy/releases/latest',
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Lockbox-private-release-validation',
      },
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!metadata.ok) throw new Error('Official metadata unavailable')
  const release = await metadata.json()
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name))
    throw new Error('Unexpected release tag')
  const name = 'caddy_' + release.tag_name.slice(1) + '_windows_amd64.zip',
    checks = 'caddy_' + release.tag_name.slice(1) + '_checksums.txt'
  const base =
    'https://github.com/caddyserver/caddy/releases/download/' +
    release.tag_name +
    '/'
  for (const asset of [name, checks])
    if (
      !release.assets.some(
        (a) => a.name === asset && a.browser_download_url === base + asset,
      )
    )
      throw new Error('Official asset not found')
  const asset = release.assets.find((a) => a.name === name)
  const expected = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')?.[1]
  if (!expected || !/^[0-9a-f]{64}$/.test(expected))
    throw new Error('Expected archive checksum missing')
  const response = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'Lockbox-private-release-validation',
    },
    signal: AbortSignal.timeout(120000),
  })
  if (!response.ok || Number(response.headers.get('Content-Length')) > 80000000)
    throw new Error('Official download failed')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (
    bytes.length > 80000000 ||
    createHash('sha256').update(bytes).digest('hex') !== expected
  )
    throw new Error('Official checksum verification failed')
  const archive = join(root, name)
  writePrivateNew(archive, bytes)
  if (!resolve(binary).startsWith(resolve(root) + sep))
    throw new Error('Unexpected tool destination')
  const script =
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::OpenRead($env:LOCKBOX_VALIDATION_ARCHIVE); try { $entry=$zip.Entries | Where-Object { $_.FullName -eq 'caddy.exe' }; if (-not $entry) { throw 'Executable absent' }; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$env:LOCKBOX_VALIDATION_OUTPUT,$false) } finally { $zip.Dispose() }"
  const extracted = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        ...process.env,
        LOCKBOX_VALIDATION_ARCHIVE: archive,
        LOCKBOX_VALIDATION_OUTPUT: binary,
      },
      stdio: 'pipe',
      windowsHide: true,
    },
  )
  if (extracted.status !== 0)
    throw new Error('Portable executable extraction failed')
  assertPrivate(binary, 'file')
  const proof = {
    version: release.tag_name,
    source: base + name,
    archiveSha256: expected,
    binarySha256: createHash('sha256')
      .update(readFileSync(binary))
      .digest('hex'),
    verifiedAt: new Date().toISOString(),
  }
  writeFileSync(manifest, JSON.stringify(proof, null, 2) + '\n', {
    mode: 0o600,
  })
  assertPrivate(manifest, 'file')
  process.stdout.write(
    'Official portable Caddy prepared and checksum verified: ' +
      release.tag_name +
      '\n',
  )
}
