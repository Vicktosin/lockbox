// Maintainer entry point. All configuration belongs to the deployment process, never household users.
import { loadRestoredDeployment } from '../server/config/deployment.ts'
import { loadFoundationConfig } from '../server/config/foundation.ts'
import { provisionInstallation } from '../server/maintenance/provision.ts'
import { join, dirname } from 'node:path'
try {
  const env = loadRestoredDeployment(process.env),
    config = loadFoundationConfig(env)
  if (!config.production) throw new Error('PRODUCTION_CONFIGURATION_REQUIRED')
  const result = provisionInstallation(
    config,
    join(dirname(config.keyFile), 'handoff'),
  )
  process.stdout.write(
    JSON.stringify(result) +
      '\nOwner link is in the protected handoff file. Do not print or log it. No listener or service was started.\n',
  )
} catch (error) {
  process.stderr.write(
    'Installation preparation failed: ' +
      (/^[A-Z_]+$/.test(error?.code ?? '')
        ? error.code
        : 'CHECK_PROTECTED_CONFIGURATION_AND_EXISTING_INSTALLATION') +
      '\n',
  )
  process.exitCode = 1
}
