// Maintainer CLI: creates protected files only, never contacts a provider or reads an existing vault.
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { privateDeploymentPlan } from '../server/maintenance/private-deployment.ts'
import {
  assertPrivate,
  requireEmptyDirectory,
} from '../server/security/private-files.ts'
import { writePrivateNew } from '../server/security/key-file.ts'
try {
  const args = process.argv.slice(2)
  if (args[0] === '--verify' && args.length === 2) {
    const directory = resolve(args[1])
    assertPrivate(directory, 'directory')
    assertPrivate(join(directory, 'plan.json'), 'file')
    const metadata = JSON.parse(
      readFileSync(join(directory, 'plan.json'), 'utf8'),
    )
    const expected = privateDeploymentPlan(metadata.hostname, metadata.profile)
    if (JSON.stringify(metadata) !== JSON.stringify(expected))
      throw new Error('PRIVATE_PLAN_CHANGED')
    for (const [name, contents] of Object.entries(expected.files)) {
      assertPrivate(join(directory, name), 'file')
      if (readFileSync(join(directory, name), 'utf8') !== contents)
        throw new Error('PRIVATE_PLAN_CHANGED')
    }
    console.log(
      JSON.stringify({
        verified: true,
        profile: expected.profile,
        origin: expected.origin,
        deployed: false,
      }),
    )
  } else {
    const options = new Map()
    for (let i = 0; i < args.length; i += 2) {
      if (
        !['--hostname', '--profile', '--output'].includes(args[i]) ||
        !args[i + 1] ||
        options.has(args[i])
      )
        throw new Error('INVALID_ARGUMENTS')
      options.set(args[i], args[i + 1])
    }
    if (options.size !== 3)
      throw new Error(
        'Use --hostname, --profile and --output (maintainer only).',
      )
    const plan = privateDeploymentPlan(
        options.get('--hostname'),
        options.get('--profile'),
      ),
      directory = resolve(options.get('--output'))
    requireEmptyDirectory(directory)
    for (const [name, contents] of Object.entries(plan.files))
      writePrivateNew(join(directory, name), contents)
    writePrivateNew(join(directory, 'plan.json'), JSON.stringify(plan) + '\n')
    console.log(
      JSON.stringify({
        prepared: true,
        profile: plan.profile,
        origin: plan.origin,
        output: directory,
        googleConfigured: false,
        deployed: false,
      }),
    )
  }
} catch {
  console.error(
    'Private deployment preparation failed. Check the hostname/profile, private output permissions and empty destination. Existing files were not replaced.',
  )
  process.exitCode = 1
}
