// Sanitised maintainer inventory. Missing external prerequisites are never treated as live success.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { loadFoundationConfig } from '../server/config/foundation.ts'
import { loadRestoredDeployment } from '../server/config/deployment.ts'
import { loadGoogleApplication } from '../server/drive/config.ts'
import { openInitializedDatabase } from '../server/database/migrations.ts'
import { loadKeyFile, verifyDatabaseKeys } from '../server/security/key-file.ts'
const env = loadRestoredDeployment(process.env),
  config = loadFoundationConfig(env),
  app = loadGoogleApplication(env, config.origin)
const result = {
  time: new Date().toISOString(),
  platform: process.platform,
  google: {
    developerRegistrationConfigured: !!app,
    normalRedirect: config.origin + '/api/drive/callback',
    recoveryRedirect: 'http://127.0.0.1:18888/callback',
    requiredScope: 'https://www.googleapis.com/auth/drive',
    connection: 'not-inspected',
    liveTests: 'NOT RUN',
    reason: app
      ? 'Human consent and recorded disposable-data live rehearsal required'
      : 'Developer-owned OAuth registration/client configuration absent',
  },
  database: { schema: 'not-inspected', keyBinding: 'not-inspected' },
  browsers: {
    chrome: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe'),
    edge: existsSync(
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ),
  },
  caddy: { verifiedPortableBinary: false, version: null },
  systemd:
    process.platform === 'linux'
      ? 'requires actual unit/host validation'
      : 'NOT RUN: Windows host',
  publicDeployment: 'not-performed',
}
let db
try {
  db = openInitializedDatabase(config.dbPath)
  verifyDatabaseKeys(db, loadKeyFile(config.keyFile))
  result.database = { schema: 'verified', keyBinding: 'verified' }
  const row = db.prepare('SELECT status FROM drive_connection WHERE id=1').get()
  result.google.connection = row?.status ?? 'disconnected'
} catch {
  result.database = {
    schema: 'unavailable-or-invalid',
    keyBinding: 'not-verified',
  }
} finally {
  db?.close()
}
const dir = join(process.cwd(), 'server', '.data', 'phase7-tools'),
  binary = join(dir, 'caddy.exe'),
  manifest = join(dir, 'caddy-manifest.json')
if (existsSync(binary) && existsSync(manifest)) {
  const m = JSON.parse(readFileSync(manifest, 'utf8'))
  result.caddy = {
    verifiedPortableBinary:
      createHash('sha256').update(readFileSync(binary)).digest('hex') ===
      m.binarySha256,
    version: m.version,
  }
}
writeFileSync(
  'docs/phase7-environment-results.json',
  JSON.stringify(result, null, 2) + '\n',
)
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
if (
  process.argv.includes('--require-live') &&
  (!app || result.google.connection !== 'connected')
)
  process.exitCode = 1
