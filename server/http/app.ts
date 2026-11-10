import Fastify from 'fastify'
import { AuthError } from '../auth/errors.ts'
import { isVaultPath } from '../vault/routes.ts'
import { isDrivePath } from '../drive/routes.ts'
import { DriveError } from '../drive/security.ts'
import { isMaintenancePath } from '../maintenance/routes.ts'
import {
  registerAuthRoutes,
  isAuthPath,
  type AuthOptions,
} from '../auth/routes.ts'
import type { createLogger } from '../logging.ts'

export function createBackendApp(
  log?: ReturnType<typeof createLogger>,
  healthCheck: () => void = () => {},
  auth?: AuthOptions,
) {
  const app = Fastify({
    logger: false,
    // Mandatory Argon2 bootstrap can exceed the default 10s on a loaded host.
    // This bounds plugin startup only; listeners stay closed until ready.
    pluginTimeout: 60000,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
    exposeHeadRoutes: false,
    bodyLimit: 65536,
    requestTimeout: 10000,
    trustProxy: false,
  })
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'",
      )
    const path = request.url.split('?')[0]
    if (
      (path === '/api' || path.startsWith('/api/')) &&
      !(
        auth &&
        (isAuthPath(path) ||
          (auth.vaults && isVaultPath(path)) ||
          (auth.drive && isDrivePath(path)) ||
          (auth.maintenance && isMaintenancePath(path)))
      )
    )
      return reply.code(503).send({ code: 'INTEGRATION_NOT_IMPLEMENTED' })
  })
  app.addHook('onResponse', async () => {
    log?.('info', 'http.response')
  })
  app.get('/healthz', async (_request, reply) => {
    try {
      healthCheck()
      return {
        status: 'foundation',
        database: 'ready',
        storage: auth?.vaults ? 'client-encrypted' : 'disabled',
        authentication: auth ? 'enabled' : 'not-implemented',
      }
    } catch {
      return reply.code(503).send({ code: 'FOUNDATION_UNAVAILABLE' })
    }
  })
  if (auth)
    app.register(async (scope) => {
      await registerAuthRoutes(scope, auth)
    })
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ code: 'NOT_FOUND' }),
  )
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DriveError) {
      const code = error.code
      const status =
        code === 'DRIVE_APPLICATION_NOT_CONFIGURED'
          ? 503
          : code.includes('ADMINISTRATOR') || code === 'DRIVE_ACCESS_DENIED'
            ? 403
            : code.includes('CONFLICT') ||
                code === 'DRIVE_SYNC_BUSY' ||
                code === 'BACKUP_BUSY' ||
                code === 'DRIVE_ALREADY_CONNECTED'
              ? 409
              : code.includes('LINK_INVALID') ||
                  code.includes('AUTHORIZATION_EXPIRED')
                ? 400
                : 502
      return reply.code(status).send({ code })
    }
    if (error instanceof AuthError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter)
      return reply.code(error.status).send({ code: error.code })
    }
    const httpError = error as { validation?: unknown; statusCode?: number }
    if (
      httpError.validation ||
      (httpError.statusCode &&
        httpError.statusCode >= 400 &&
        httpError.statusCode < 500)
    )
      return reply
        .code(httpError.statusCode ?? 400)
        .send({ code: 'INVALID_REQUEST' })
    log?.('error', 'http.failure', { code: 'HTTP_REQUEST_FAILED' })
    return reply.code(500).send({ code: 'REQUEST_FAILED' })
  })
  return app
}
