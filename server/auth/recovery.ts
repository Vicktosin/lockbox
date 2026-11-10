import * as argon2 from 'argon2'
import { createHash, randomBytes } from 'node:crypto'
import type { Sqlite } from '../database/connection.ts'
import { AuthError } from './errors.ts'
import { canonicalUsername, passwordOptions, validPassword } from './service.ts'
import { createLimiter } from './rate-limit.ts'

const digest = (code: string) =>
  createHash('sha256')
    .update('LOCKBOX-LOGIN-RECOVERY-V1\0')
    .update(code)
    .digest()
export function createRecoveryService(db: Sqlite, now = Date.now) {
  const limit = createLimiter(now)
  let working = 0
  async function work<T>(fn: () => Promise<T>) {
    if (working >= 2) throw new AuthError(429, 'TRY_LATER', 1)
    working++
    try {
      return await fn()
    } finally {
      working--
    }
  }
  async function reauthenticate(userId: string, password: string) {
    limit('reauth:' + userId, 5, 15 * 60000)
    const row = db
      .prepare(
        'SELECT password_hash,active,password_reset_required FROM users WHERE id=?',
      )
      .get(userId) as
      | {
          password_hash: string
          active: number
          password_reset_required: number
        }
      | undefined
    if (
      !row ||
      !row.active ||
      row.password_reset_required ||
      !(await work(() => argon2.verify(row.password_hash, password)))
    )
      throw new AuthError(401, 'INVALID_CREDENTIALS')
    const fresh = db
      .prepare(
        'SELECT password_hash,active,password_reset_required FROM users WHERE id=?',
      )
      .get(userId) as typeof row
    if (
      !fresh?.active ||
      fresh.password_reset_required ||
      fresh.password_hash !== row.password_hash
    )
      throw new AuthError(401, 'INVALID_CREDENTIALS')
    return row.password_hash
  }
  return {
    reauthenticate,
    async issue(userId: string, password: string) {
      const hash = await reauthenticate(userId, password)
      const code = randomBytes(32).toString('base64url')
      db.transaction(() => {
        if (
          !db
            .prepare(
              'SELECT 1 FROM users WHERE id=? AND active=1 AND password_hash=? AND password_reset_required=0',
            )
            .get(userId, hash)
        )
          throw new AuthError(401, 'INVALID_CREDENTIALS')
        db.prepare(
          'INSERT INTO login_recovery(user_id,token_digest,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_digest=excluded.token_digest,created_at=excluded.created_at,consumed_at=NULL',
        ).run(userId, digest(code), now())
      }).immediate()
      return { code }
    },
    async reset(
      input: {
        username: string
        code: string
        password: string
        passwordConfirmation: string
      },
      ip: string,
    ) {
      limit('reset-ip:' + ip, 10, 15 * 60000)
      const name = canonicalUsername(input.username)
      limit('reset-name:' + name.canonical, 5, 15 * 60000)
      if (
        !validPassword(input.password) ||
        input.password !== input.passwordConfirmation
      )
        throw new AuthError(400, 'INVALID_REGISTRATION_INPUT')
      // Hash for known and unknown usernames alike; recovery codes have 256 bits of entropy.
      const hash = await work(() =>
        argon2.hash(input.password, passwordOptions),
      )
      db.transaction(() => {
        const row = db
          .prepare(
            'SELECT u.id FROM users u JOIN login_recovery r ON r.user_id=u.id WHERE u.username_canonical=? AND u.active=1 AND r.token_digest=? AND r.consumed_at IS NULL',
          )
          .get(name.canonical, digest(input.code)) as { id: string } | undefined
        if (!row) throw new AuthError(401, 'RECOVERY_FAILED')
        db.prepare(
          'UPDATE login_recovery SET consumed_at=? WHERE user_id=?',
        ).run(now(), row.id)
        db.prepare(
          'UPDATE users SET password_hash=?,password_reset_required=0,updated_at=? WHERE id=?',
        ).run(hash, now(), row.id)
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id)
        db.prepare('DELETE FROM account_tokens WHERE user_id=?').run(row.id)
      }).immediate()
    },
  }
}
