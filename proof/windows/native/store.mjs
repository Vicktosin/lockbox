import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ensurePrivateDirectory,
  assertPrivate,
} from '../../../server/security/private-files.ts'
import { writePrivateNew } from '../../../server/security/key-file.ts'
import { check } from './errors.mjs'

/** Reuses file protections only. Never opens the legacy database or its key file. */
export class PrivateStore {
  constructor(directory, protector) {
    this.directory = directory
    this.protector = protector
    ensurePrivateDirectory(directory)
    this.file = join(directory, 'fictional-proof.sealed')
    check(protector.available(), 'PROOF_OS_ENCRYPTION_UNAVAILABLE')
  }
  load() {
    if (!existsSync(this.file)) return null
    assertPrivate(this.file, 'file')
    const bytes = readFileSync(this.file)
    check(bytes.length < 16000000, 'PROOF_STORE_LIMIT')
    return JSON.parse(this.protector.decrypt(bytes))
  }
  save(value) {
    const bytes = this.protector.encrypt(JSON.stringify(value))
    check(bytes.length < 16000000, 'PROOF_STORE_LIMIT')
    const temp = join(this.directory, '.write-' + randomUUID())
    writePrivateNew(temp, bytes)
    renameSync(temp, this.file)
    assertPrivate(this.file, 'file')
  }
}
