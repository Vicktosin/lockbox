import {
  mkdirSync,
  lstatSync,
  realpathSync,
  chmodSync,
  readdirSync,
} from 'node:fs'
import { isAbsolute, resolve, dirname, parse, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fail } from '../errors.ts'

export function absolutePath(value: string): string {
  if (!isAbsolute(value) || value.includes('\0') || value === ':memory:')
    fail('PATH_INVALID')
  const result = resolve(value)
  if (
    process.platform === 'win32' &&
    (!/^[A-Za-z]:\\/.test(result) || result.slice(2).includes(':'))
  )
    fail('PATH_INVALID')
  if (result === parse(result).root) fail('PATH_INVALID')
  return result
}
export function rejectLinks(path: string) {
  const target = absolutePath(path)
  let current = parse(target).root
  for (const part of target
    .slice(current.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part)
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
    if (stat.isSymbolicLink()) fail('PATH_LINK_REJECTED')
    if (
      resolve(realpathSync.native(current)).toLowerCase() !==
      resolve(current).toLowerCase()
    )
      fail('PATH_LINK_REJECTED')
  }
}
const aclScript = `
$ErrorActionPreference = 'Stop'
$p = $env:LOCKBOX_ACL_TARGET
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed = @($identity.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($env:LOCKBOX_ACL_CREATE -eq '1') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetOwner($identity)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in $allowed) {
    $principal = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $p -AclObject $acl
}
$acl = Get-Acl -LiteralPath $p
if ($allowed -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { throw 'owner' }
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) { throw 'access' }
}
`
function windowsAcl(path: string, create: boolean) {
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', aclScript],
      {
        env: {
          ...process.env,
          LOCKBOX_ACL_TARGET: path,
          LOCKBOX_ACL_CREATE: create ? '1' : '0',
        },
        stdio: 'pipe',
        windowsHide: true,
        timeout: 15000,
      },
    )
  } catch {
    fail('PRIVATE_PERMISSIONS_REQUIRED')
  }
}
export function assertPrivate(path: string, kind: 'file' | 'directory') {
  rejectLinks(path)
  const stat = lstatSync(path)
  if (
    kind === 'file' ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()
  )
    fail('PRIVATE_PATH_INVALID')
  if (process.platform === 'win32') windowsAcl(path, false)
  else if (
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    fail('PRIVATE_PERMISSIONS_REQUIRED')
}
export function ensurePrivateDirectory(path: string) {
  rejectLinks(path)
  let created = false
  try {
    mkdirSync(path, { mode: 0o700 })
    created = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      ensurePrivateDirectory(dirname(path))
      mkdirSync(path, { mode: 0o700 })
      created = true
    } else if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  if (created) {
    if (process.platform === 'win32') windowsAcl(path, true)
    else chmodSync(path, 0o700)
  }
  assertPrivate(path, 'directory')
}
/** Restore must target an empty, dedicated directory; never replace a live database. */
export function requireEmptyDirectory(path: string) {
  ensurePrivateDirectory(path)
  if (readdirSync(path).length) fail('RESTORE_DIRECTORY_NOT_EMPTY')
}
