import { loadFoundationConfig } from './config/foundation.ts'
import { openInitializedDatabase } from './database/migrations.ts'
import { loadKeyFile, verifyDatabaseKeys } from './security/key-file.ts'
import { createLogger } from './logging.ts'
import { createBackendApp } from './http/app.ts'
import { FoundationError } from './errors.ts'
import { loadGoogleApplication } from './drive/config.ts'
import { upgradeExistingDatabase } from './database/upgrade.ts'
import { loadRestoredDeployment } from './config/deployment.ts'

const fallbackLog = createLogger()
async function start() {
  const environment = loadRestoredDeployment(process.env)
  const config = loadFoundationConfig(environment)
  const log = createLogger(config.logLevel)
  await upgradeExistingDatabase(config)
  const db = openInitializedDatabase(config.dbPath)
  try {
    verifyDatabaseKeys(db, loadKeyFile(config.keyFile))
  } catch (error) {
    db.close()
    throw error
  }
  const app = createBackendApp(
    log,
    () => {
      db.prepare('SELECT 1').get()
    },
    {
      db,
      origin: config.origin,
      production: config.production,
      vaults: true,
      maintenance: {
        config,
        secrets: {
          googleClientId: environment.LOCKBOX_GOOGLE_CLIENT_ID,
          googleClientSecret: environment.LOCKBOX_GOOGLE_CLIENT_SECRET,
        },
      },
      drive: {
        keys: loadKeyFile(config.keyFile),
        application: loadGoogleApplication(environment, config.origin),
      },
    },
  )
  app.addHook('onClose', async () => {
    db.close()
  })
  try {
    await app.listen({ port: config.port, host: '127.0.0.1' })
    log('info', 'backend.ready')
  } catch (error) {
    await app.close()
    throw error
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void app.close().catch(() => {
        log('error', 'backend.close_failed')
        process.exitCode = 1
      })
    })
}
start().catch((error: unknown) => {
  fallbackLog('error', 'backend.start_failed', {
    code:
      error instanceof FoundationError ? error.code : 'FOUNDATION_START_FAILED',
  })
  process.exitCode = 1
})
