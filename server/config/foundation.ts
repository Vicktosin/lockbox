import { fileURLToPath } from 'node:url'
import { dirname, relative, isAbsolute } from 'node:path'
import { absolutePath } from '../security/private-files.ts'
import type { LogLevel } from '../logging.ts'
import { fail } from '../errors.ts'

export function loadFoundationConfig(
  environment: Record<string, string | undefined>,
) {
  if (
    environment.NODE_ENV &&
    !['development', 'test', 'production'].includes(environment.NODE_ENV)
  )
    fail('CONFIG_ENVIRONMENT_INVALID')
  const production = environment.NODE_ENV === 'production'
  const value = (name: string) => environment[name]?.trim()
  const portText = value('LOCKBOX_BACKEND_PORT') || '8787'
  if (
    !/^\d+$/.test(portText) ||
    Number(portText) < 1 ||
    Number(portText) > 65535
  )
    fail('CONFIG_PORT_INVALID')
  const defaults = (path: string) =>
    fileURLToPath(new URL(path, import.meta.url))
  if (
    production &&
    [
      'LOCKBOX_DB_PATH',
      'LOCKBOX_KEY_FILE',
      'LOCKBOX_APP_ORIGIN',
      'LOCKBOX_BACKUP_DIR',
    ].some((name) => !value(name))
  )
    fail('CONFIG_PRODUCTION_REQUIRED')
  const dbPath = absolutePath(
    value('LOCKBOX_DB_PATH') || defaults('../.data/db/lockbox.sqlite'),
  )
  const keyFile = absolutePath(
    value('LOCKBOX_KEY_FILE') || defaults('../.data/keys/application-key.json'),
  )
  const backupDirectory = absolutePath(
    value('LOCKBOX_BACKUP_DIR') || defaults('../.data/backups'),
  )
  const origin = new URL(value('LOCKBOX_APP_ORIGIN') || 'http://localhost:5173')
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !['http:', 'https:'].includes(origin.protocol)
  )
    fail('CONFIG_ORIGIN_INVALID')
  if (production && origin.protocol !== 'https:') fail('CONFIG_HTTPS_REQUIRED')
  if (
    !production &&
    origin.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  )
    fail('CONFIG_HTTPS_REQUIRED')
  const contains = (parent: string, child: string) => {
    const r = relative(parent, child)
    return !r || (!r.startsWith('..') && !isAbsolute(r))
  }
  if (
    contains(dirname(dbPath), keyFile) ||
    contains(backupDirectory, keyFile) ||
    contains(dirname(keyFile), dbPath) ||
    contains(dirname(keyFile), backupDirectory) ||
    contains(backupDirectory, dbPath)
  )
    fail('CONFIG_STORAGE_OVERLAP')
  const workspace = defaults('../../')
  if (
    [dbPath, keyFile, backupDirectory].some((path) =>
      ['../../src/', '../../public/', '../../dist/'].some((dir) =>
        contains(defaults(dir), path),
      ),
    )
  )
    fail('CONFIG_PUBLIC_STORAGE_REJECTED')
  if (
    [dbPath, keyFile, backupDirectory].some(
      (path) =>
        contains(workspace, path) && !contains(defaults('../.data/'), path),
    )
  )
    fail('CONFIG_PROJECT_STORAGE_REJECTED')
  if (
    production &&
    [dbPath, keyFile, backupDirectory].some((path) => contains(workspace, path))
  )
    fail('CONFIG_PRODUCTION_STORAGE_OUTSIDE_PROJECT')
  const level = value('LOCKBOX_LOG_LEVEL') || 'info'
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(level))
    fail('CONFIG_LOG_LEVEL_INVALID')
  return {
    port: Number(portText),
    dbPath,
    keyFile,
    backupDirectory,
    origin: origin.origin,
    production,
    logLevel: level as LogLevel,
  }
}
