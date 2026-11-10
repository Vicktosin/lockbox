import {
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
export function packageRelease(
  source = process.cwd(),
  destination = join(
    source,
    'releases',
    'lockbox-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      randomUUID(),
  ),
) {
  if (existsSync(destination)) throw new Error('RELEASE_DESTINATION_EXISTS')
  if (!existsSync(join(source, 'dist/index.html')))
    throw new Error('BUILD_REQUIRED')
  // Allowlist only: never copy .data, environment files, dependencies, extension candidate or reports with local paths.
  mkdirSync(destination, { recursive: true })
  const copy = (path, filter) =>
    cpSync(join(source, path), join(destination, path), {
      recursive: true,
      filter,
    })
  const runtimeFilter = (path) =>
    !lstatSync(path).isSymbolicLink() &&
    !path.split(/[\\/]/).some((part) => part.startsWith('.'))
  for (const path of ['server', 'shared']) copy(path, runtimeFilter)
  for (const path of ['dist', 'deploy']) copy(path, runtimeFilter)
  for (const path of [
    'package.json',
    'package-lock.json',
    'scripts/install-prepare.mjs',
    'scripts/prepare-private-deployment.mjs',
    'scripts/deployment-health.mjs',
    'scripts/recovery-assistant.mjs',
    'scripts/restore-complete.mjs',
    'docs/household-release.md',
    'docs/private-online-deployment.md',
    'docs/operations.md',
    'docs/google-maintainer-checklist.md',
  ])
    copy(path)
  const hashes = {}
  const scan = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) scan(path)
      else
        hashes[relative(destination, path).replaceAll('\\', '/')] = createHash(
          'sha256',
        )
          .update(readFileSync(path))
          .digest('hex')
    }
  }
  scan(destination)
  writeFileSync(
    join(destination, 'SHA256SUMS.json'),
    JSON.stringify(hashes, null, 2) + '\n',
  )
  return destination
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  console.log(
    'Prepared offline release directory: ' +
      packageRelease() +
      '\nNo service was started or deployed. Maintainer must validate Linux installation and approve HTTPS exposure.',
  )
