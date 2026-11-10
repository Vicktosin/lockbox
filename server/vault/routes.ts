import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Sqlite } from '../database/connection.ts'
import type { ActiveSession, AuthService } from '../auth/service.ts'
import { AuthError } from '../auth/errors.ts'
import type { OffdeviceService } from '../maintenance/offdevice.ts'
import type {
  Envelope,
  StoredVault,
  VaultState,
  VaultProfile,
} from '../../shared/client-vault.ts'

const paths = [
  'state',
  'setup',
  'profile',
  'personal',
  'move',
  'household/create',
  'household/grant',
  'household/join',
  'household/save',
  'household/revoke',
  'history',
]
export const isVaultPath = (path: string) =>
  paths.some((name) => path === '/api/vault/' + name)
const b64 = (min: number, max: number) => ({
  type: 'string',
  minLength: min,
  maxLength: max,
  pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
})
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
})
const envelope = object({
  v: { const: 1 },
  alg: { const: 'XChaCha20-Poly1305' },
  nonce: b64(32, 32),
  ciphertext: b64(24, 900000),
})
const profile = object({
  v: { const: 1 },
  kdf: object({
    name: { const: 'Argon2id' },
    memory: { const: 65536 },
    iterations: { const: 3 },
    parallelism: { const: 1 },
    salt: b64(24, 24),
  }),
  master: envelope,
  recovery: envelope,
  keyring: envelope,
})
const revision = {
  type: 'integer',
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER - 1,
}
const uuid = {
  type: 'string',
  pattern:
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
}
interface ProfileRow {
  user_id: string
  revision: number
  data: string
}
interface VaultRow {
  id: string
  scope: 'personal' | 'shared'
  owner_id: string
  revision: number
  payload: string
  key_check: string | null
}
const stored = (row: VaultRow): StoredVault => ({
  id: row.id,
  scope: row.scope,
  ownerId: row.owner_id,
  revision: row.revision,
  payload: JSON.parse(row.payload) as Envelope,
  check: row.key_check ? (JSON.parse(row.key_check) as Envelope) : null,
})
export function registerVaultRoutes(
  app: FastifyInstance,
  db: Sqlite,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => ActiveSession,
  service: AuthService,
  onChanged: () => void = () => {},
  offdevice?: OffdeviceService,
) {
  const conflict = () => {
    throw new AuthError(409, 'VAULT_CONFLICT')
  }
  const state = (userId: string): VaultState => {
    const row = db
      .prepare('SELECT * FROM client_vault_profiles WHERE user_id=?')
      .get(userId) as ProfileRow | undefined
    const own = db
      .prepare(
        "SELECT * FROM client_vaults WHERE scope='personal' AND owner_id=?",
      )
      .get(userId) as VaultRow | undefined
    const shared = db
      .prepare(
        "SELECT v.*,m.joined FROM client_vaults v JOIN client_vault_members m ON m.vault_id=v.id WHERE v.scope='shared' AND m.user_id=?",
      )
      .get(userId) as (VaultRow & { joined: number }) | undefined
    return {
      profile: row
        ? { revision: row.revision, data: JSON.parse(row.data) as VaultProfile }
        : null,
      personal: own ? stored(own) : null,
      household: shared
        ? { ...stored(shared), joined: Boolean(shared.joined) }
        : null,
      candidates:
        shared?.owner_id === userId
          ? (db
              .prepare(
                "SELECT u.id,u.username_display AS username,CASE WHEN m.user_id IS NULL THEN 'none' WHEN m.joined=1 THEN 'joined' ELSE 'invited' END AS access FROM users u LEFT JOIN client_vault_members m ON m.user_id=u.id AND m.vault_id=? WHERE u.active=1 AND u.id<>?",
              )
              .all(shared.id, userId) as {
              id: string
              username: string
              access: 'none' | 'invited' | 'joined'
            }[])
          : [],
    }
  }
  const updateProfile = (
    userId: string,
    expected: number,
    data: VaultProfile,
  ) => {
    if (
      db
        .prepare(
          'UPDATE client_vault_profiles SET revision=revision+1,data=? WHERE user_id=? AND revision=?',
        )
        .run(JSON.stringify(data), userId, expected).changes !== 1
    )
      conflict()
  }
  app.get('/api/vault/state', async (request, reply) =>
    state(authenticate(request, reply).user.id),
  )
  app.get<{ Querystring: { id?: string } }>(
    '/api/vault/history',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,14}$' } },
        },
      },
    },
    async (request, reply) => {
      const user = authenticate(request, reply).user.id
      const allowed =
        "(h.scope='personal' AND h.owner_id=? OR h.scope='shared' AND EXISTS(SELECT 1 FROM client_vault_members m WHERE m.vault_id=h.vault_id AND m.user_id=? AND m.joined=1))"
      const accessible =
        '(SELECT id,vault_id,owner_id,scope,revision,saved_at,pinned FROM vault_history UNION ALL SELECT id,vault_id,owner_id,scope,revision,saved_at,1 AS pinned FROM archived_history)'
      if (request.query.id) {
        const row = db
          .prepare(
            'SELECT h.* FROM vault_history h WHERE h.id=? AND ' + allowed,
          )
          .get(Number(request.query.id), user, user) as
          (VaultRow & { vault_id: string }) | undefined
        if (!row) {
          const archived = db
            .prepare(
              'SELECT h.* FROM archived_history h WHERE id=? AND ' + allowed,
            )
            .get(Number(request.query.id), user, user)
          if (!archived || !offdevice)
            throw new AuthError(404, 'HISTORY_NOT_FOUND')
          const h = await offdevice.history(Number(request.query.id))
          authenticate(request, reply)
          // Recheck authorization after network I/O; revocation during a download must win.
          if (
            !db
              .prepare(
                'SELECT h.id FROM archived_history h WHERE id=? AND ' + allowed,
              )
              .get(h.id, user, user)
          )
            throw new AuthError(403, 'REQUEST_FORBIDDEN')
          return { vault: stored({ ...h, id: h.vault_id }) }
        }
        return { vault: stored({ ...row, id: row.vault_id }) }
      }
      return {
        history: db
          .prepare(
            'SELECT h.id,h.scope,h.revision,h.saved_at,h.pinned FROM ' +
              accessible +
              ' h WHERE ' +
              allowed +
              ' ORDER BY h.id DESC LIMIT 100',
          )
          .all(user, user),
      }
    },
  )
  const route = <T>(
    path: string,
    schema: Record<string, unknown>,
    action: (session: ActiveSession, body: T) => void,
  ) =>
    app.post<{ Body: T }>(
      '/api/vault/' + path,
      {
        bodyLimit: path === 'move' ? 2097152 : 1048576,
        schema: { body: object(schema) },
      },
      async (request, reply) => {
        const session = authenticate(request, reply)
        service.checkCsrf(session, request.headers['x-csrf-token'])
        try {
          db.transaction(() => action(session, request.body as T)).immediate()
        } catch (error) {
          if (
            (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')
          )
            conflict()
          throw error
        }
        onChanged()
        return state(session.user.id)
      },
    )
  route<{ profile: VaultProfile; payload: Envelope }>(
    'setup',
    { profile, payload: envelope },
    (session, body) => {
      if (
        db
          .prepare('SELECT 1 FROM client_vault_profiles WHERE user_id=?')
          .get(session.user.id)
      )
        conflict()
      db.prepare(
        'INSERT INTO client_vault_profiles(user_id,revision,data) VALUES(?,1,?)',
      ).run(session.user.id, JSON.stringify(body.profile))
      db.prepare(
        "INSERT INTO client_vaults(id,scope,owner_id,revision,payload) VALUES(?,'personal',?,1,?)",
      ).run(
        'personal:' + session.user.id,
        session.user.id,
        JSON.stringify(body.payload),
      )
    },
  )
  route<{ revision: number; profile: VaultProfile }>(
    'profile',
    { revision, profile },
    (session, body) =>
      updateProfile(session.user.id, body.revision, body.profile),
  )
  route<{ revision: number; payload: Envelope }>(
    'personal',
    { revision, payload: envelope },
    (session, body) => {
      if (
        db
          .prepare(
            "UPDATE client_vaults SET revision=revision+1,payload=? WHERE scope='personal' AND owner_id=? AND revision=?",
          )
          .run(JSON.stringify(body.payload), session.user.id, body.revision)
          .changes !== 1
      )
        conflict()
    },
  )
  route<{
    id: string
    revision: number
    profile: VaultProfile
    payload: Envelope
    check: Envelope
  }>(
    'household/create',
    { id: uuid, revision, profile, payload: envelope, check: envelope },
    (session, body) => {
      if (session.user.role !== 'administrator')
        throw new AuthError(403, 'REQUEST_FORBIDDEN')
      updateProfile(session.user.id, body.revision, body.profile)
      db.prepare(
        "INSERT INTO client_vaults(id,scope,owner_id,revision,payload,key_check) VALUES(?,'shared',?,1,?,?)",
      ).run(
        body.id,
        session.user.id,
        JSON.stringify(body.payload),
        JSON.stringify(body.check),
      )
      db.prepare(
        'INSERT INTO client_vault_members(vault_id,user_id,joined) VALUES(?,?,1)',
      ).run(body.id, session.user.id)
    },
  )
  route<{ userId: string }>(
    'household/grant',
    { userId: uuid },
    (session, body) => {
      const household = db
        .prepare(
          "SELECT id FROM client_vaults WHERE scope='shared' AND owner_id=?",
        )
        .get(session.user.id) as { id: string } | undefined
      if (
        !household ||
        !db
          .prepare('SELECT 1 FROM users WHERE id=? AND active=1 AND id<>?')
          .get(body.userId, session.user.id)
      )
        throw new AuthError(403, 'REQUEST_FORBIDDEN')
      db.prepare(
        'INSERT INTO client_vault_members(vault_id,user_id,joined) VALUES(?,?,0) ON CONFLICT DO NOTHING',
      ).run(household.id, body.userId)
    },
  )
  route<{ revision: number; profile: VaultProfile }>(
    'household/join',
    { revision, profile },
    (session, body) => {
      const member = db
        .prepare(
          'SELECT vault_id FROM client_vault_members WHERE user_id=? AND joined=0',
        )
        .get(session.user.id) as { vault_id: string } | undefined
      if (!member) throw new AuthError(403, 'REQUEST_FORBIDDEN')
      updateProfile(session.user.id, body.revision, body.profile)
      db.prepare(
        'UPDATE client_vault_members SET joined=1 WHERE user_id=? AND vault_id=?',
      ).run(session.user.id, member.vault_id)
    },
  )
  route<{ revision: number; payload: Envelope }>(
    'household/save',
    { revision, payload: envelope },
    (session, body) => {
      const member = db
        .prepare(
          'SELECT vault_id FROM client_vault_members WHERE user_id=? AND joined=1',
        )
        .get(session.user.id) as { vault_id: string } | undefined
      if (!member) throw new AuthError(403, 'REQUEST_FORBIDDEN')
      if (
        db
          .prepare(
            'UPDATE client_vaults SET revision=revision+1,payload=? WHERE id=? AND revision=?',
          )
          .run(JSON.stringify(body.payload), member.vault_id, body.revision)
          .changes !== 1
      )
        conflict()
    },
  )
  route<{
    personalRevision: number
    personal: Envelope
    sharedRevision: number
    shared: Envelope
  }>(
    'move',
    {
      personalRevision: revision,
      personal: envelope,
      sharedRevision: revision,
      shared: envelope,
    },
    (session, body) => {
      const member = db
        .prepare(
          'SELECT vault_id FROM client_vault_members WHERE user_id=? AND joined=1',
        )
        .get(session.user.id) as { vault_id: string } | undefined
      if (!member) throw new AuthError(403, 'REQUEST_FORBIDDEN')
      if (
        db
          .prepare(
            "UPDATE client_vaults SET revision=revision+1,payload=? WHERE scope='personal' AND owner_id=? AND revision=?",
          )
          .run(
            JSON.stringify(body.personal),
            session.user.id,
            body.personalRevision,
          ).changes !== 1
      )
        conflict()
      if (
        db
          .prepare(
            'UPDATE client_vaults SET revision=revision+1,payload=? WHERE id=? AND revision=?',
          )
          .run(
            JSON.stringify(body.shared),
            member.vault_id,
            body.sharedRevision,
          ).changes !== 1
      )
        conflict()
    },
  )
  route<{
    userId: string
    revision: number
    profileRevision: number
    profile: VaultProfile
    payload: Envelope
    check: Envelope
  }>(
    'household/revoke',
    {
      userId: uuid,
      revision,
      profileRevision: revision,
      profile,
      payload: envelope,
      check: envelope,
    },
    (session, body) => {
      const household = db
        .prepare(
          "SELECT id FROM client_vaults WHERE scope='shared' AND owner_id=?",
        )
        .get(session.user.id) as { id: string } | undefined
      if (!household || body.userId === session.user.id)
        throw new AuthError(403, 'REQUEST_FORBIDDEN')
      if (
        db
          .prepare(
            'DELETE FROM client_vault_members WHERE vault_id=? AND user_id=?',
          )
          .run(household.id, body.userId).changes !== 1
      )
        throw new AuthError(404, 'MEMBER_NOT_FOUND')
      updateProfile(session.user.id, body.profileRevision, body.profile)
      if (
        db
          .prepare(
            'UPDATE client_vaults SET revision=revision+1,payload=?,key_check=? WHERE id=? AND revision=?',
          )
          .run(
            JSON.stringify(body.payload),
            JSON.stringify(body.check),
            household.id,
            body.revision,
          ).changes !== 1
      )
        conflict()
    },
  )
}
