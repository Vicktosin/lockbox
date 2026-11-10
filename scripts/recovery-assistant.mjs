import { createRecoveryAssistant } from '../server/maintenance/recovery-assistant.ts'
import { loadGoogleApplication } from '../server/drive/config.ts'
import { resolve, join } from 'node:path'
import { rmSync } from 'node:fs'
import { requireEmptyDirectory } from '../server/security/private-files.ts'
import { writePrivateNew } from '../server/security/key-file.ts'
const origin = 'http://127.0.0.1:18888'
const [target, workspace] = process.argv.slice(2)
if (!target || !workspace) {
  process.stderr.write(
    'Maintainer usage: npm run recovery:assistant -- <empty-absolute-installation> <empty-private-workspace>\n',
  )
  process.exitCode = 1
} else {
  try {
    const configured = loadGoogleApplication(process.env, origin)
    if (!configured)
      throw new Error('RECOVERY_DEVELOPER_GOOGLE_APPLICATION_REQUIRED')
    const { app, launchUrl } = createRecoveryAssistant({
      origin,
      target: resolve(target),
      workspace: resolve(workspace),
      application: { ...configured, redirectUri: origin + '/callback' },
    })
    requireEmptyDirectory(resolve(workspace))
    const launchFile = join(resolve(workspace), 'launch-url.txt')
    writePrivateNew(launchFile, launchUrl + '\n')
    app.addHook('onClose', async () => {
      rmSync(launchFile, { force: true })
    })
    await app.listen({ host: '127.0.0.1', port: 18888 })
    process.stdout.write(
      'Private recovery assistant ready. Open launch-url.txt in the protected workspace. Stop after restoration; never share the launch file.\n',
    )
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => void app.close())
  } catch {
    process.stderr.write(
      'Recovery assistant could not start. Check maintainer Google registration, private paths and port availability.\n',
    )
    process.exitCode = 1
  }
}
