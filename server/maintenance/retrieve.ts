import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { EncryptedFileStore } from '../drive/provider.ts'
import { DriveError } from '../drive/security.ts'
import { writePrivateNew } from '../security/key-file.ts'
import { requireEmptyDirectory } from '../security/private-files.ts'
import { restoreComplete } from './complete.ts'
// A fresh OAuth connection and the separately held emergency key are sufficient; no original database/server key.
export async function retrieveAndRestore(
  store: EncryptedFileStore,
  fileId: string,
  emergencyFile: string,
  target: string,
  downloadDirectory: string,
  expectedDatabaseId?: string,
) {
  await store.validateFolder()
  requireEmptyDirectory(downloadDirectory)
  const remote = await store.read(fileId, 'backup')
  const hash = createHash('sha256').update(remote.sealed).digest('hex')
  if (remote.meta.appProperties?.hash !== hash)
    throw new DriveError('BACKUP_REMOTE_MISMATCH')
  const archive = join(downloadDirectory, 'retrieved.lbx')
  writePrivateNew(archive, remote.sealed)
  return restoreComplete(archive, emergencyFile, target, expectedDatabaseId)
}
