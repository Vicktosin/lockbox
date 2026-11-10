import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Sqlite } from '../database/connection.ts'
import { AuthError } from './errors.ts'

export type AccountRole = 'administrator' | 'member'
export const inviteDigest = (token: string) =>
  createHash('sha256').update('LOCKBOX-INVITE-V1\0').update(token).digest()
export function invitationRoleAllowed(db: Sqlite, role: AccountRole) {
  const total = (
    db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }
  ).n
  const active = (
    db.prepare('SELECT count(*) AS n FROM users WHERE active=1').get() as {
      n: number
    }
  ).n
  const admin = db
    .prepare("SELECT id FROM users WHERE active=1 AND role='administrator'")
    .get()
  return role === 'administrator' ? total === 0 : Boolean(admin) && active < 2
}
/** Local-operator provisioning only. Not exposed through an HTTP endpoint. */
export function issueRegistrationInvite(
  db: Sqlite,
  role: AccountRole,
  now = Date.now(),
) {
  if (!['administrator', 'member'].includes(role))
    throw new AuthError(400, 'INVALID_INVITATION_ROLE')
  const token = randomBytes(32).toString('base64url'),
    id = randomUUID(),
    expiresAt = now + 24 * 60 * 60 * 1000
  db.transaction(() => {
    if (!invitationRoleAllowed(db, role))
      throw new AuthError(409, 'REGISTRATION_NOT_AVAILABLE')
    db.prepare(
      "UPDATE account_tokens SET consumed_at=? WHERE purpose='invite' AND invite_role=? AND consumed_at IS NULL",
    ).run(now, role)
    db.prepare(
      "INSERT INTO account_tokens(id,token_digest,purpose,created_at,expires_at,invite_role) VALUES(?,?,'invite',?,?,?)",
    ).run(id, inviteDigest(token), now, expiresAt, role)
  }).immediate()
  return { id, inviteCode: token, expiresAt, role }
}
