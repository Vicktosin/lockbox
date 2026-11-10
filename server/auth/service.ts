import * as argon2 from 'argon2'
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import type { Sqlite } from '../database/connection.ts'
import { createLimiter } from './rate-limit.ts'
import { AuthError } from './errors.ts'
import {
  inviteDigest,
  invitationRoleAllowed,
  type AccountRole,
} from './invitations.ts'

export interface PublicUser {
  id: string
  username: string
  role: AccountRole
}
interface UserRow {
  id: string
  username_display: string
  role: AccountRole
  password_hash: string
  active: number
  password_reset_required: number
}
interface SessionRow {
  id: string
  user_id: string
  created_at: number
  last_seen_at: number
  idle_expires_at: number
  absolute_expires_at: number
  username_display: string
  role: AccountRole
  active: number
  password_reset_required: number
}
export interface ActiveSession {
  id: string
  user: PublicUser
  csrfToken: string
}
const minute = 60000,
  idle = 30 * minute,
  absolute = 12 * 60 * minute
export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const
export const sessionDigest = (token: string) =>
  createHash('sha256').update('LOCKBOX-SESSION-V1\0').update(token).digest()
const csrfFor = (token: string) =>
  createHmac('sha256', token).update('LOCKBOX-CSRF-V1').digest('base64url')
export function canonicalUsername(value: string) {
  const trimmed = value.replace(/^[\t\r\n ]+|[\t\r\n ]+$/g, '')
  if (!/^[A-Za-z0-9_]{3,32}$/.test(trimmed))
    throw new AuthError(400, 'INVALID_REQUEST')
  return { display: trimmed, canonical: trimmed.toLowerCase() }
}
export function validPassword(password: string) {
  return (
    !/[\uD800-\uDFFF]/u.test(password) &&
    [...password].length >= 15 &&
    [...password].length <= 128 &&
    Buffer.byteLength(password, 'utf8') <= 512
  )
}
function publicUser(
  row: Pick<UserRow, 'id' | 'username_display' | 'role'>,
): PublicUser {
  return { id: row.id, username: row.username_display, role: row.role }
}
function deviceLabel(agent: string) {
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser'
  const os = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Unknown device'
  return `${browser} on ${os}`
}
export async function createAuthService(
  db: Sqlite,
  now: () => number = Date.now,
) {
  const limiter = createLimiter(now)
  let hashing = 0
  async function hashWork<T>(operation: () => Promise<T>) {
    if (hashing >= 2) throw new AuthError(429, 'TRY_LATER', 1)
    hashing++
    try {
      return await operation()
    } finally {
      hashing--
    }
  }
  const dummy = await argon2.hash(randomBytes(32), passwordOptions)
  const userByName = db.prepare(
    'SELECT id,username_display,role,password_hash,active,password_reset_required FROM users WHERE username_canonical=?',
  )
  return {
    clearLoginRateLimit(username: string) {
      limiter.reset('login-user:' + canonicalUsername(username).canonical)
    },
    async register(
      input: {
        username: string
        password: string
        passwordConfirmation: string
        inviteCode: string
      },
      ip: string,
    ) {
      limiter('register:' + ip, 5, 60 * minute)
      const name = canonicalUsername(input.username)
      if (
        !validPassword(input.password) ||
        !validPassword(input.passwordConfirmation)
      )
        throw new AuthError(400, 'INVALID_REGISTRATION_INPUT')
      const first = Buffer.from(input.password),
        second = Buffer.from(input.passwordConfirmation)
      const equal =
        first.length === second.length && timingSafeEqual(first, second)
      first.fill(0)
      second.fill(0)
      if (!equal) throw new AuthError(400, 'PASSWORD_CONFIRMATION_MISMATCH')
      const digest = inviteDigest(input.inviteCode)
      const invite = db
        .prepare(
          "SELECT id,invite_role FROM account_tokens WHERE token_digest=? AND purpose='invite' AND consumed_at IS NULL AND expires_at>?",
        )
        .get(digest, now()) as
        { id: string; invite_role: AccountRole } | undefined
      if (!invite || !invitationRoleAllowed(db, invite.invite_role))
        throw new AuthError(409, 'REGISTRATION_NOT_AVAILABLE')
      const hash = await hashWork(() =>
        argon2.hash(input.password, passwordOptions),
      )
      const id = randomUUID()
      try {
        db.transaction(() => {
          const time = now()
          if (!invitationRoleAllowed(db, invite.invite_role))
            throw new AuthError(409, 'REGISTRATION_NOT_AVAILABLE')
          const consumed = db
            .prepare(
              "UPDATE account_tokens SET consumed_at=?,user_id=NULL WHERE id=? AND token_digest=? AND purpose='invite' AND invite_role=? AND consumed_at IS NULL AND expires_at>?",
            )
            .run(time, invite.id, digest, invite.invite_role, time)
          if (consumed.changes !== 1)
            throw new AuthError(409, 'REGISTRATION_NOT_AVAILABLE')
          db.prepare(
            'INSERT INTO users(id,username_display,username_canonical,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          ).run(
            id,
            name.display,
            name.canonical,
            hash,
            invite.invite_role,
            time,
            time,
          )
          db.prepare('UPDATE account_tokens SET user_id=? WHERE id=?').run(
            id,
            invite.id,
          )
        }).immediate()
      } catch (error) {
        if (error instanceof AuthError) throw error
        if ((error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT'))
          throw new AuthError(409, 'REGISTRATION_NOT_AVAILABLE')
        throw error
      }
      return {
        id,
        username: name.display,
        role: invite.invite_role,
      } satisfies PublicUser
    },
    async login(
      input: { username: string; password: string },
      ip: string,
      userAgent: string,
    ) {
      const name = canonicalUsername(input.username)
      limiter('login-ip:' + ip, 30, 15 * minute)
      limiter('login-user:' + name.canonical, 5, 15 * minute)
      const row = userByName.get(name.canonical) as UserRow | undefined
      let valid = false
      try {
        valid = await hashWork(() =>
          argon2.verify(row?.password_hash ?? dummy, input.password),
        )
      } catch (error) {
        if (error instanceof AuthError) throw error
      }
      if (!valid || !row || !row.active || row.password_reset_required)
        throw new AuthError(401, 'INVALID_CREDENTIALS')
      const upgradedHash = argon2.needsRehash(
        row.password_hash,
        passwordOptions,
      )
        ? await hashWork(() => argon2.hash(input.password, passwordOptions))
        : null
      const token = randomBytes(32).toString('base64url'),
        sessionId = randomUUID(),
        time = now()
      const agent = [...userAgent]
        .filter(
          (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
        )
        .join('')
        .slice(0, 160)
      db.transaction(() => {
        const fresh = userByName.get(name.canonical) as UserRow | undefined
        if (
          !fresh ||
          !fresh.active ||
          fresh.password_reset_required ||
          fresh.password_hash !== row.password_hash
        )
          throw new AuthError(401, 'INVALID_CREDENTIALS')
        if (upgradedHash)
          db.prepare(
            'UPDATE users SET password_hash=?,updated_at=? WHERE id=?',
          ).run(upgradedHash, time, row.id)
        db.prepare(
          'DELETE FROM sessions WHERE user_id=? AND (idle_expires_at<=? OR absolute_expires_at<=?)',
        ).run(row.id, time, time)
        // Bound accumulated sessions for this small household; never expose raw tokens.
        db.prepare(
          'DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 9)',
        ).run(row.id)
        db.prepare(
          'INSERT INTO sessions(id,token_digest,user_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at,device_label,user_agent) VALUES(?,?,?,?,?,?,?,?,?)',
        ).run(
          sessionId,
          sessionDigest(token),
          row.id,
          time,
          time,
          time + idle,
          time + absolute,
          deviceLabel(agent),
          agent,
        )
      }).immediate()
      limiter.reset('login-user:' + name.canonical)
      return { user: publicUser(row), token, csrfToken: csrfFor(token) }
    },
    authenticate(token: string | undefined): ActiveSession | null {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
      const row = db
        .prepare(
          'SELECT s.*,u.username_display,u.role,u.active,u.password_reset_required FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_digest=?',
        )
        .get(sessionDigest(token)) as SessionRow | undefined
      if (!row) return null
      const time = now()
      if (
        !row.active ||
        row.password_reset_required ||
        row.idle_expires_at <= time ||
        row.absolute_expires_at <= time
      ) {
        db.prepare('DELETE FROM sessions WHERE id=?').run(row.id)
        return null
      }
      db.prepare(
        'UPDATE sessions SET last_seen_at=?,idle_expires_at=? WHERE id=?',
      ).run(time, Math.min(time + idle, row.absolute_expires_at), row.id)
      return {
        id: row.id,
        user: {
          id: row.user_id,
          username: row.username_display,
          role: row.role,
        },
        csrfToken: csrfFor(token),
      }
    },
    checkCsrf(session: ActiveSession, value: unknown) {
      if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value) ||
        !timingSafeEqual(Buffer.from(value), Buffer.from(session.csrfToken))
      )
        throw new AuthError(403, 'REQUEST_FORBIDDEN')
    },
    listSessions(session: ActiveSession) {
      return (
        db
          .prepare(
            'SELECT id,device_label,created_at,last_seen_at,absolute_expires_at FROM sessions WHERE user_id=? AND idle_expires_at>? AND absolute_expires_at>? ORDER BY created_at DESC',
          )
          .all(session.user.id, now(), now()) as {
          id: string
          device_label: string
          created_at: number
          last_seen_at: number
          absolute_expires_at: number
        }[]
      ).map((row) => ({
        id: row.id,
        device: row.device_label,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.absolute_expires_at,
        current: row.id === session.id,
      }))
    },
    revoke(session: ActiveSession, id: string) {
      if (
        db
          .prepare('DELETE FROM sessions WHERE id=? AND user_id=?')
          .run(id, session.user.id).changes !== 1
      )
        throw new AuthError(404, 'SESSION_NOT_FOUND')
    },
    revokeToken(token: string | undefined) {
      if (token && /^[A-Za-z0-9_-]{43}$/.test(token))
        db.prepare('DELETE FROM sessions WHERE token_digest=?').run(
          sessionDigest(token),
        )
    },
    logoutAll(session: ActiveSession) {
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.user.id)
    },
  }
}
export type AuthService = Awaited<ReturnType<typeof createAuthService>>
