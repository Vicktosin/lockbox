import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Sqlite } from '../database/connection.ts'
import type { ActiveSession, AuthService } from '../auth/service.ts'
import { AuthError } from '../auth/errors.ts'
import { createRecoveryService } from '../auth/recovery.ts'
import { createMaintenanceService, type MaintenanceOptions } from './service.ts'
export const isMaintenancePath = (path: string) =>
  [
    'status',
    'backup',
    'emergency-key',
    'policy',
    'destination',
    'compact',
  ].some((x) => path === '/api/maintenance/' + x)
export function registerMaintenanceRoutes(
  app: FastifyInstance,
  db: Sqlite,
  options: MaintenanceOptions,
  authenticate: (r: FastifyRequest, p: FastifyReply) => ActiveSession,
  auth: AuthService,
) {
  const maintenance = createMaintenanceService(db, options),
    recovery = createRecoveryService(db)
  const admin = (r: FastifyRequest, p: FastifyReply) => {
    const s = authenticate(r, p)
    if (s.user.role !== 'administrator')
      throw new AuthError(403, 'REQUEST_FORBIDDEN')
    return s
  }
  const mutation = (r: FastifyRequest, p: FastifyReply) => {
    const s = admin(r, p)
    auth.checkCsrf(s, r.headers['x-csrf-token'])
    return s
  }
  app.get('/api/maintenance/status', async (r, p) => {
    admin(r, p)
    return maintenance.status()
  })
  const empty = { type: 'object', additionalProperties: false, properties: {} }
  app.post<{
    Body: { folderLink: string; keyConfirmation: string; password: string }
  }>(
    '/api/maintenance/destination',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['folderLink', 'keyConfirmation', 'password'],
          properties: {
            folderLink: { type: 'string', minLength: 1, maxLength: 2000 },
            keyConfirmation: { type: 'string', minLength: 43, maxLength: 43 },
            password: { type: 'string', minLength: 1, maxLength: 512 },
          },
        },
      },
    },
    async (r, p) => {
      const s = mutation(r, p)
      await recovery.reauthenticate(s.user.id, r.body.password)
      if (!options.offdevice)
        throw new AuthError(503, 'DRIVE_APPLICATION_NOT_CONFIGURED')
      await options.offdevice.configure(
        r.body.folderLink,
        r.body.keyConfirmation,
      )
      await maintenance.backup()
      return maintenance.status()
    },
  )
  app.post(
    '/api/maintenance/compact',
    { schema: { body: empty } },
    async (r, p) => {
      mutation(r, p)
      if (!options.offdevice) throw new AuthError(503, 'BACKUP_NOT_CONFIGURED')
      await options.offdevice.archive()
      await maintenance.backup()
      return maintenance.status()
    },
  )
  app.post(
    '/api/maintenance/backup',
    { schema: { body: empty } },
    async (r, p) => {
      mutation(r, p)
      await maintenance.backup()
      return maintenance.status()
    },
  )
  app.post<{ Body: { password: string } }>(
    '/api/maintenance/emergency-key',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['password'],
          properties: {
            password: { type: 'string', minLength: 1, maxLength: 512 },
          },
        },
      },
    },
    async (r, p) => {
      const s = mutation(r, p)
      await recovery.reauthenticate(s.user.id, r.body.password)
      return {
        key: maintenance.emergencyKey(),
        installationId: (
          db
            .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
            .get() as { value: string }
        ).value,
      }
    },
  )
  app.post<{ Body: { backupDays: number; historyDays: number } }>(
    '/api/maintenance/policy',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['backupDays', 'historyDays'],
          properties: {
            backupDays: { type: 'integer', minimum: 7, maximum: 365 },
            historyDays: { type: 'integer', minimum: 7, maximum: 3650 },
          },
        },
      },
    },
    async (r, p) => {
      mutation(r, p)
      maintenance.setPolicy(r.body.backupDays, r.body.historyDays)
      return maintenance.status()
    },
  )
  app.addHook('onReady', async () => {
    if (options.background !== false) maintenance.start()
  })
  app.addHook('onClose', async () => maintenance.close())
}
