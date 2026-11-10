// Offline maintainer utility, never a household-user setup step. Never overwrites a running database.
import { restoreComplete } from '../server/maintenance/complete.ts'
const [archive, keyFile, target, ...extra] = process.argv.slice(2)
if (!archive || !keyFile || !target || extra.length) {
  process.stderr.write(
    'Usage: npm run recovery:restore -- <encrypted-bundle> <saved-emergency-key-file> <empty-absolute-target>\n',
  )
  process.exitCode = 1
} else {
  try {
    restoreComplete(archive, keyFile, target)
    process.stdout.write(
      'Clean restoration verified. Deploy using the protected deployment.json. Login recovery and Google reconnection are required.\n',
    )
  } catch {
    process.stderr.write(
      'Restoration failed. No live database was overwritten. Quarantine any incomplete target and check backup/key integrity.\n',
    )
    process.exitCode = 1
  }
}
