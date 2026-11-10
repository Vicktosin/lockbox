import {
  cpSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  existsSync,
  renameSync,
} from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  proof = join(root, 'proof/windows'),
  built = join(root, 'releases/native-proof-build'),
  output = join(root, 'releases', 'LockboxProof-Windows-' + Date.now())
if (!existsSync(join(built, 'main/main.mjs')))
  throw new Error('Build the proof first')
mkdirSync(output, { recursive: true })
cpSync(join(proof, 'node_modules/electron/dist'), output, { recursive: true })
renameSync(join(output, 'electron.exe'), join(output, 'LockboxProof.exe'))
const app = join(output, 'resources/app')
mkdirSync(app, { recursive: true })
for (const name of ['main', 'renderer', 'node_modules'])
  cpSync(join(built, name), join(app, name), { recursive: true })
if (existsSync(join(built, 'public-config.json')))
  copyFileSync(
    join(built, 'public-config.json'),
    join(app, 'public-config.json'),
  )
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify({
    name: 'lockbox-fictional-proof',
    version: '0.1.0',
    type: 'module',
    main: 'main/main.mjs',
  }) + '\n',
)
writeFileSync(
  join(output, 'Open-owner.cmd'),
  '@echo off\r\nstart "" "%~dp0LockboxProof.exe" --profile=owner --role=owner\r\n',
)
writeFileSync(
  join(output, 'Open-partner.cmd'),
  '@echo off\r\nstart "" "%~dp0LockboxProof.exe" --profile=partner --role=partner\r\n',
)
writeFileSync(
  join(output, 'README.txt'),
  'FICTIONAL DATA ONLY. Unsigned feasibility package, not a production release.\r\nLaunch LockboxProof.exe (owner), or Open-partner.cmd for the independent partner profile.\r\nGoogle registration must be configured by the developer before real consent is possible. No client secret belongs in this package.\r\nLocal proof data is isolated in AppData/LockboxFeasibilityProof-v1. No legacy database is read.\r\n',
)
const hashes = {}
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) scan(file)
    else
      hashes[relative(output, file).replaceAll('\\', '/')] = createHash(
        'sha256',
      )
        .update(readFileSync(file))
        .digest('hex')
  }
}
scan(output)
writeFileSync(
  join(output, 'SHA256SUMS.json'),
  JSON.stringify(hashes, null, 2) + '\n',
)
console.log(output)
