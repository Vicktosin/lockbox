import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ActiveSession, AuthService } from '../auth/service.ts'
import type { Sqlite } from '../database/connection.ts'
import { createDriveService, type DriveOptions } from './service.ts'
import { DriveError } from './security.ts'
const paths = ['status', 'connect', 'callback', 'sync', 'disconnect', 'resolve']
export const isDrivePath = (path: string) =>
  paths.some((name) => path === '/api/drive/' + name)
const empty = { type: 'object', additionalProperties: false, properties: {} }
export function registerDriveRoutes(
  app: FastifyInstance,
  db: Sqlite,
  options: DriveOptions,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => ActiveSession,
  auth: AuthService,
) {
  const drive = createDriveService(db, options)
  app.addHook('onReady', async () => {
    if (options.background !== false) drive.start()
  })
  app.addHook('onClose', async () => drive.close())
  const mutation = (request: FastifyRequest, reply: FastifyReply) => {
    const session = authenticate(request, reply)
    auth.checkCsrf(session, request.headers['x-csrf-token'])
    return session
  }
  app.get('/api/drive/status', async (request, reply) =>
    drive.status(authenticate(request, reply)),
  )
  app.post<{ Body: { folderLink: string } }>(
    '/api/drive/connect',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['folderLink'],
          properties: {
            folderLink: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) =>
      drive.begin(mutation(request, reply), request.body.folderLink),
  )
  app.get<{ Querystring: { state: string; code?: string; error?: string } }>(
    '/api/drive/callback',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['state'],
          properties: {
            state: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
            code: { type: 'string', minLength: 1, maxLength: 4096 },
            error: { type: 'string', maxLength: 256 },
            error_description: { type: 'string', maxLength: 1024 },
            error_uri: { type: 'string', maxLength: 2048 },
            iss: { const: 'https://accounts.google.com' },
            hd: { type: 'string', maxLength: 253 },
            scope: { type: 'string', maxLength: 4096 },
            authuser: { type: 'string', maxLength: 16 },
            prompt: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const session = authenticate(request, reply)
      if (session.user.role !== 'administrator')
        throw new DriveError('DRIVE_ADMINISTRATOR_REQUIRED')
      try {
        await drive.callback(session, request.query)
      } catch (error) {
        drive.recordError(error)
      }
      return reply.redirect('/#/settings')
    },
  )
  app.post(
    '/api/drive/sync',
    { schema: { body: empty } },
    async (request, reply) => {
      const session = mutation(request, reply)
      const changed = await drive.sync()
      return drive.status(session, changed)
    },
  )
  app.post(
    '/api/drive/disconnect',
    { schema: { body: empty } },
    async (request, reply) => {
      const session = mutation(request, reply)
      await drive.disconnect(session)
      return drive.status(session)
    },
  )
  app.post<{ Body: { id: string; copy: string } }>(
    '/api/drive/resolve',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'copy'],
          properties: {
            id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
            copy: { type: 'string', pattern: '^(local|[a-f0-9]{64})$' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = mutation(request, reply)
      const changed = await drive.resolve(
        session,
        request.body.id,
        request.body.copy,
      )
      return drive.status(session, changed)
    },
  )
  return drive
}
