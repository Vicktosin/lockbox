import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import type { Sqlite } from '../database/connection.ts'
import { createAuthService } from './service.ts'
import { AuthError } from './errors.ts'
import { registerVaultRoutes, isVaultPath } from '../vault/routes.ts'
import { registerDriveRoutes, isDrivePath } from '../drive/routes.ts'
import type { DriveOptions } from '../drive/service.ts'
import { createRecoveryService } from './recovery.ts'
import {
  registerMaintenanceRoutes,
  isMaintenancePath,
} from '../maintenance/routes.ts'
import type { MaintenanceOptions } from '../maintenance/service.ts'
import { createOffdeviceService } from '../maintenance/offdevice.ts'
import { issueRegistrationInvite } from './invitations.ts'

export interface AuthOptions {
  db: Sqlite
  origin: string
  production: boolean
  now?: () => number
  vaults?: boolean
  drive?: DriveOptions
  maintenance?: MaintenanceOptions
}
const exactPaths = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/logout-all',
  '/api/auth/sessions',
  '/api/auth/recovery-code',
  '/api/auth/recover',
  '/api/auth/invitations',
]
export const isAuthPath = (path: string) =>
  exactPaths.includes(path) ||
  /^\/api\/auth\/sessions\/[0-9a-f-]{36}\/revoke$/.test(path)
const string = (minLength: number, maxLength: number) => ({
  type: 'string',
  minLength,
  maxLength,
})
const loginBody = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: { username: string(1, 64), password: string(1, 512) },
}
const registerBody = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password', 'passwordConfirmation', 'inviteCode'],
  properties: {
    username: string(1, 64),
    password: string(1, 512),
    passwordConfirmation: string(1, 512),
    inviteCode: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  },
}
export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthOptions,
) {
  await app.register(cookie)
  const service = await createAuthService(options.db, options.now)
  const recovery = createRecoveryService(options.db, options.now)
  const secure = options.production || options.origin.startsWith('https:')
  const cookieName = secure ? '__Host-lockbox_session' : 'lockbox_dev_session'
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 12 * 60 * 60,
  }
  const clear = (reply: FastifyReply) =>
    reply.clearCookie(cookieName, {
      path: '/',
      secure,
      httpOnly: true,
      sameSite: 'lax',
    })
  const authenticate = (request: FastifyRequest, reply: FastifyReply) => {
    const session = service.authenticate(request.cookies[cookieName])
    if (!session) {
      clear(reply)
      throw new AuthError(401, 'AUTHENTICATION_REQUIRED')
    }
    return session
  }
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0]
    if (
      !isAuthPath(path) &&
      !(options.vaults && isVaultPath(path)) &&
      !(options.drive && isDrivePath(path)) &&
      !(options.maintenance && isMaintenancePath(path))
    )
      return
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers.origin !== options.origin ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new AuthError(403, 'REQUEST_FORBIDDEN')
      if (
        request.method === 'POST' &&
        !['/api/auth/logout', '/api/auth/logout-all'].includes(path) &&
        !path.endsWith('/revoke') &&
        !request.headers['content-type']?.startsWith('application/json')
      )
        throw new AuthError(415, 'JSON_REQUIRED')
    }
  })
  app.post<{
    Body: {
      username: string
      password: string
      passwordConfirmation: string
      inviteCode: string
    }
  }>(
    '/api/auth/register',
    { schema: { body: registerBody } },
    async (request, reply) => {
      const user = await service.register(request.body, request.ip)
      return reply.code(201).send({ user })
    },
  )
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: loginBody } },
    async (request, reply) => {
      const result = await service.login(
        request.body,
        request.ip,
        request.headers['user-agent'] ?? '',
      )
      service.revokeToken(request.cookies[cookieName])
      reply.setCookie(cookieName, result.token, cookieOptions)
      return { user: result.user, csrfToken: result.csrfToken }
    },
  )
  app.get('/api/auth/me', async (request, reply) => {
    const session = authenticate(request, reply)
    return { user: session.user, csrfToken: session.csrfToken }
  })
  app.post<{ Body: { password: string } }>(
    '/api/auth/invitations',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['password'],
          properties: { password: string(1, 512) },
        },
      },
    },
    async (request, reply) => {
      const session = authenticate(request, reply)
      service.checkCsrf(session, request.headers['x-csrf-token'])
      if (session.user.role !== 'administrator')
        throw new AuthError(403, 'REQUEST_FORBIDDEN')
      await recovery.reauthenticate(session.user.id, request.body.password)
      authenticate(request, reply)
      return issueRegistrationInvite(
        options.db,
        'member',
        options.now?.() ?? Date.now(),
      )
    },
  )
  app.post<{ Body: { password: string } }>(
    '/api/auth/recovery-code',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['password'],
          properties: { password: string(1, 512) },
        },
      },
    },
    async (request, reply) => {
      const session = authenticate(request, reply)
      service.checkCsrf(session, request.headers['x-csrf-token'])
      return recovery.issue(session.user.id, request.body.password)
    },
  )
  app.post<{
    Body: {
      username: string
      code: string
      password: string
      passwordConfirmation: string
    }
  }>(
    '/api/auth/recover',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'code', 'password', 'passwordConfirmation'],
          properties: {
            username: string(3, 32),
            code: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
            password: string(1, 512),
            passwordConfirmation: string(1, 512),
          },
        },
      },
    },
    async (request, reply) => {
      await recovery.reset(request.body, request.ip)
      service.clearLoginRateLimit(request.body.username)
      clear(reply)
      return reply.code(204).send()
    },
  )
  app.get('/api/auth/sessions', async (request, reply) => ({
    sessions: service.listSessions(authenticate(request, reply)),
  }))
  app.post('/api/auth/logout', async (request, reply) => {
    const session = service.authenticate(request.cookies[cookieName])
    if (session) {
      service.checkCsrf(session, request.headers['x-csrf-token'])
      service.revoke(session, session.id)
    }
    clear(reply)
    return reply.code(204).send()
  })
  app.post('/api/auth/logout-all', async (request, reply) => {
    const session = authenticate(request, reply)
    service.checkCsrf(session, request.headers['x-csrf-token'])
    service.logoutAll(session)
    clear(reply)
    return reply.code(204).send()
  })
  app.post<{ Params: { id: string } }>(
    '/api/auth/sessions/:id/revoke',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              pattern:
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const session = authenticate(request, reply)
      service.checkCsrf(session, request.headers['x-csrf-token'])
      service.revoke(session, request.params.id)
      if (request.params.id === session.id) clear(reply)
      return reply.code(204).send()
    },
  )
  const drive = options.drive
    ? registerDriveRoutes(app, options.db, options.drive, authenticate, service)
    : undefined
  const offdevice =
    drive && options.maintenance
      ? createOffdeviceService(
          options.db,
          options.maintenance.config,
          drive,
          options.now,
        )
      : undefined
  if (options.maintenance)
    registerMaintenanceRoutes(
      app,
      options.db,
      { ...options.maintenance, offdevice },
      authenticate,
      service,
    )
  if (options.vaults)
    registerVaultRoutes(
      app,
      options.db,
      authenticate,
      service,
      () => drive?.schedule(),
      offdevice,
    )
}
