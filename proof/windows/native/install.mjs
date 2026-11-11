import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
} from 'node:fs'
import { resolve, join, sep, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { check } from './errors.mjs'

/** Copies a verified application package into a new version directory. Never touches vaults. */
export function installFiles(source, programsRoot) {
  source = resolve(source)
  programsRoot = resolve(programsRoot)
  check(
    existsSync(join(source, 'Lockbox.exe')) &&
      existsSync(join(source, 'resources/app/package.json')),
    'PROOF_INSTALL_PACKAGE_REQUIRED',
  )
  const inventory = JSON.parse(
    readFileSync(join(source, 'SHA256SUMS.json'), 'utf8'),
  )
  const files = []
  function inspect(directory) {
    for (const item of readdirSync(directory)) {
      const path = join(directory, item),
        stat = lstatSync(path)
      check(!stat.isSymbolicLink(), 'PROOF_INSTALL_PATH_INVALID')
      if (stat.isDirectory()) inspect(path)
      else files.push(path)
    }
  }
  inspect(source)
  for (const [relative, expected] of Object.entries(inventory)) {
    const path = resolve(source, relative)
    check(
      !isAbsolute(relative) &&
        path.startsWith(source + sep) &&
        files.includes(path) &&
        /^[a-f0-9]{64}$/.test(expected),
      'PROOF_INSTALL_INTEGRITY_FAILED',
    )
    check(
      createHash('sha256').update(readFileSync(path)).digest('hex') ===
        expected,
      'PROOF_INSTALL_INTEGRITY_FAILED',
    )
  }
  check(
    files.every(
      (path) =>
        path === join(source, 'SHA256SUMS.json') ||
        inventory[path.slice(source.length + 1).replaceAll('\\', '/')],
    ),
    'PROOF_INSTALL_INTEGRITY_FAILED',
  )
  const destination = join(
    programsRoot,
    'LockboxPreview',
    'version-' + randomUUID(),
  )
  check(
    destination.startsWith(programsRoot + sep) &&
      !destination.startsWith(source + sep),
    'PROOF_INSTALL_PATH_INVALID',
  )
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
  })
  return join(destination, 'Lockbox.exe')
}
