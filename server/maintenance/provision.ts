import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  initializeDatabase,
  openInitializedDatabase,
} from '../database/migrations.ts'
import {
  initializeKeyFile,
  loadKeyFile,
  verifyDatabaseKeys,
  writePrivateNew,
} from '../security/key-file.ts'
import {
  assertPrivate,
  ensurePrivateDirectory,
} from '../security/private-files.ts'
import { initializeEmergencyKey } from './complete.ts'
import { issueRegistrationInvite } from '../auth/invitations.ts'
import type { loadFoundationConfig } from '../config/foundation.ts'
import { fail } from '../errors.ts'

/** Offline maintainer provisioning. Does not start listeners, publish DNS or create user accounts. */
export function provisionInstallation(
  config: ReturnType<typeof loadFoundationConfig>,
  handoffDirectory: string,
) {
  if (!config.production) fail('INSTALL_PRODUCTION_REQUIRED')
  ensurePrivateDirectory(handoffDirectory)
  const existed = existsSync(config.dbPath)
  if (!existed && existsSync(config.keyFile))
    fail('INSTALL_EXISTING_KEY_WITHOUT_DATABASE')
  initializeDatabase(config.dbPath)
  const db = openInitializedDatabase(config.dbPath)
  try {
    if (existed) verifyDatabaseKeys(db, loadKeyFile(config.keyFile))
    else initializeKeyFile(db, config.keyFile)
    initializeEmergencyKey(
      config,
      Boolean(db.prepare('SELECT 1 FROM backup_destination LIMIT 1').get()),
    )
    const accountCount = (
      db.prepare('SELECT count(*) n FROM users').get() as { n: number }
    ).n
    const file = join(handoffDirectory, 'owner-invitation.json')
    if (accountCount === 0) {
      if (existsSync(file)) {
        assertPrivate(file, 'file')
        const stored = JSON.parse(readFileSync(file, 'utf8')) as {
          id: string
          expiresAt: number
        }
        const live = db
          .prepare(
            "SELECT 1 FROM account_tokens WHERE id=? AND purpose='invite' AND invite_role='administrator' AND consumed_at IS NULL AND expires_at>?",
          )
          .get(stored.id, Date.now())
        if (!live) fail('INSTALL_OWNER_INVITATION_EXPIRED')
      } else {
        if (
          db
            .prepare(
              "SELECT 1 FROM account_tokens WHERE purpose='invite' AND invite_role='administrator' AND consumed_at IS NULL AND expires_at>?",
            )
            .get(Date.now())
        )
          fail('INSTALL_OWNER_INVITATION_ALREADY_PROVISIONED')
        const invite = issueRegistrationInvite(db, 'administrator')
        try {
          writePrivateNew(
            file,
            JSON.stringify({
              id: invite.id,
              expiresAt: invite.expiresAt,
              url: config.origin + '/#/join/' + invite.inviteCode,
            }) + '\n',
          )
        } catch (error) {
          db.prepare('UPDATE account_tokens SET consumed_at=? WHERE id=?').run(
            Date.now(),
            invite.id,
          )
          throw error
        }
      }
    }
    return {
      database: existed ? 'existing-verified' : 'created',
      accountsPreserved: accountCount,
      ownerInvitation: accountCount ? 'not-needed' : 'protected-file-ready',
      httpsOrigin: config.origin,
    }
  } finally {
    db.close()
  }
}
