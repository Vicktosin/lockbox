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
  output = join(root, 'releases', 'Lockbox-Windows-Preview-' + Date.now())
if (!existsSync(join(built, 'main/main.mjs')))
  throw new Error('Build the proof first')
mkdirSync(output, { recursive: true })
cpSync(join(proof, 'node_modules/electron/dist'), output, { recursive: true })
renameSync(join(output, 'electron.exe'), join(output, 'Lockbox.exe'))
copyFileSync(join(output, 'Lockbox.exe'), join(output, 'LockboxSetup.exe'))
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
    name: 'lockbox-windows-preview',
    version: '0.2.1',
    type: 'module',
    main: 'main/main.mjs',
  }) + '\n',
)
writeFileSync(
  join(output, 'README.txt'),
  'LOCKBOX FOR WINDOWS - PREVIEW. FICTIONAL DATA ONLY. Not a production release.\r\nTo install: double-click LockboxSetup.exe and choose owner or partner. Open Lockbox Preview from the Windows Start menu afterward. No terminal is required.\r\nGoogle tests use the separate Lockbox Google Drive test Start menu shortcut. Ordinary vault uploads are blocked until security requirements pass. Test profiles never import existing vaults.\r\nTo run without installation: open Lockbox.exe; select the appropriate household role before vault setup.\r\nGoogle registration must be supplied by the developer before real consent is possible. No client secret belongs in this package.\r\nExisting Windows profiles remain in AppData/LockboxFeasibilityProof-v1. No legacy database is read.\r\nThe package is unsigned. Checksums detect corruption, not publisher identity. Do not bypass Windows security warnings.\r\n',
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
