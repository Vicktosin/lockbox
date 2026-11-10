// Intentionally displays only an operator-issued invitation in a real local terminal,
// never a redirected process, captured tool output or application log.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { loadFoundationConfig } from '../server/config/foundation.ts'
import { loadRestoredDeployment } from '../server/config/deployment.ts'
import { openInitializedDatabase } from '../server/database/migrations.ts'
import { assertPrivate } from '../server/security/private-files.ts'
import { inviteDigest } from '../server/auth/invitations.ts'
import {
  loadKeyFile,
  verifyDatabaseKeys,
  writePrivateNew,
} from '../server/security/key-file.ts'

const file = process.argv[2] ? resolve(process.argv[2]) : ''
try {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('PRIVATE_INTERACTIVE_TERMINAL_REQUIRED')
  if (!file) throw new Error('PRIVATE_INVITATION_FILE_REQUIRED')
  assertPrivate(file, 'file')
  const invitation = JSON.parse(readFileSync(file, 'utf8'))
  if (
    invitation.role !== 'administrator' ||
    !/^[A-Za-z0-9_-]{43}$/.test(invitation.inviteCode) ||
    invitation.expiresAt <= Date.now()
  )
    throw new Error('ADMINISTRATOR_INVITATION_INVALID')
  const config = loadFoundationConfig(loadRestoredDeployment(process.env))
  const db = openInitializedDatabase(config.dbPath)
  try {
    verifyDatabaseKeys(db, loadKeyFile(config.keyFile))
    const valid = db
      .prepare(
        "SELECT 1 FROM account_tokens WHERE id=? AND token_digest=? AND purpose='invite' AND invite_role='administrator' AND consumed_at IS NULL AND expires_at>?",
      )
      .get(invitation.id, inviteDigest(invitation.inviteCode), Date.now())
    if (!valid || db.prepare('SELECT 1 FROM users LIMIT 1').get())
      throw new Error('FIRST_ADMINISTRATOR_REGISTRATION_UNAVAILABLE')
  } finally {
    db.close()
  }
  process.stdout.write('\nLOCKBOX — FIRST ADMINISTRATOR REGISTRATION\n\n')
  process.stdout.write(
    'Open ' + config.origin + '/ and select Create account.\n',
  )
  process.stdout.write('Enter this private ADMINISTRATOR invitation code:\n\n')
  process.stdout.write(invitation.inviteCode + '\n\n')
  process.stdout.write(
    'Valid until ' +
      new Date(invitation.expiresAt).toLocaleString() +
      '. Works once.\nClose this terminal after use. Never post the invitation in chat.\n',
  )
  if (!existsSync(file + '.displayed.json'))
    writePrivateNew(
      file + '.displayed.json',
      JSON.stringify({
        displayedAt: Date.now(),
        destination: 'interactive-local-terminal',
      }) + '\n',
    )
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    await terminal.question('Press Enter to close this display when finished. ')
  } finally {
    terminal.close()
  }
} catch (reason) {
  if (file) {
    try {
      writePrivateNew(
        file + '.display-error.json',
        JSON.stringify({
          code: /^[A-Z_]+$/.test(reason?.code ?? reason?.message ?? '')
            ? (reason.code ?? reason.message)
            : 'PRIVATE_DISPLAY_FAILED',
        }) + '\n',
      )
    } catch {
      /* An existing diagnostic is never replaced. */
    }
  }
  process.stderr.write(
    'The private administrator invitation display stopped. Check the local terminal.\n',
  )
  process.exitCode = 1
}
