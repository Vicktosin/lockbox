import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Sqlite } from '../database/connection.ts'
import type { DriveService } from '../drive/service.ts'
import { parseFolder, DriveError, digest } from '../drive/security.ts'
import {
  inspectComplete,
  emergencyKeyPath,
  type CompleteConfig,
} from './complete.ts'
interface Destination {
  folder_id: string
  folder_name: string
  resource_key: string | null
  last_success: number | null
  last_error: string | null
  retry_at: number | null
  key_saved_at: number | null
  key_check: string
}
interface Delivery {
  backup_id: string
  folder_id: string
  file_id: string
  digest: string
  verified_at: number | null
}
const checksum = (data: Buffer | string) =>
  createHash('sha256').update(data).digest('hex')
export function createOffdeviceService(
  db: Sqlite,
  config: CompleteConfig,
  drive: DriveService,
  now = Date.now,
) {
  let ioBusy = false
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (ioBusy) throw new DriveError('BACKUP_BUSY')
    ioBusy = true
    try {
      return await operation()
    } finally {
      ioBusy = false
    }
  }
  let running: Promise<void> | undefined,
    closed = false
  const destination = () =>
    db.prepare('SELECT * FROM backup_destination WHERE id=1').get() as
      Destination | undefined
  const currentKey = () => readFileSync(emergencyKeyPath(config), 'utf8').trim()
  const store = (d: Destination) =>
    drive.backupStore({ id: d.folder_id, resourceKey: d.resource_key })
  const valid = (d: Destination) => {
    const fresh = destination()
    if (
      closed ||
      fresh?.folder_id !== d.folder_id ||
      fresh.key_check !== d.key_check
    )
      throw new DriveError('BACKUP_DESTINATION_CHANGED')
  }
  function status() {
    const d = destination(),
      source = db
        .prepare(
          'SELECT MAX(b.created_at) t FROM backup_runs b JOIN backup_deliveries x ON x.backup_id=b.id WHERE x.folder_id=? AND x.verified_at IS NOT NULL',
        )
        .get(d?.folder_id ?? '') as { t: number | null }
    return {
      configured: !!d,
      folderName: d?.folder_name ?? null,
      folderId: d?.folder_id ?? null,
      lastSuccess: d?.last_success ?? null,
      sourceCreatedAt: source.t,
      error: d?.last_error ?? null,
      retryAt: d?.retry_at ?? null,
      stale: !source.t || now() - source.t > 48 * 3600000,
      running: !!running,
      archived: db.prepare('SELECT count(*) n FROM archived_history').get() as {
        n: number
      },
    }
  }
  async function configure(link: string, confirmation: string) {
    if (running || ioBusy) throw new DriveError('BACKUP_BUSY')
    const expected = Buffer.from(currentKey()),
      entered = Buffer.from(confirmation.trim())
    try {
      if (
        expected.length !== entered.length ||
        !timingSafeEqual(expected, entered)
      )
        throw new DriveError('BACKUP_KEY_CONFIRMATION_REQUIRED')
    } finally {
      expected.fill(0)
      entered.fill(0)
    }
    const folder = parseFolder(link),
      adapter = await drive.backupStore(folder),
      meta = await adapter.validateFolder(),
      old = destination()
    if (
      old &&
      old.folder_id !== folder.id &&
      db.prepare('SELECT 1 FROM backup_deliveries LIMIT 1').get()
    )
      throw new DriveError('BACKUP_ARCHIVES_PIN_DESTINATION')
    db.prepare(
      'INSERT INTO backup_destination(id,folder_id,folder_name,resource_key,key_saved_at,key_check) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET folder_id=excluded.folder_id,folder_name=excluded.folder_name,resource_key=excluded.resource_key,key_saved_at=excluded.key_saved_at,key_check=excluded.key_check,last_error=NULL,retry_at=NULL,last_success=CASE WHEN backup_destination.folder_id=excluded.folder_id THEN backup_destination.last_success ELSE NULL END',
    ).run(
      folder.id,
      meta.name,
      folder.resourceKey,
      now(),
      checksum(currentKey()),
    )
  }
  function verify(bytes: string) {
    return inspectComplete(
      Buffer.from(bytes),
      emergencyKeyPath(config),
      config.backupDirectory,
      (check) => {
        const original = db
          .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
          .get() as { value: string }
        const restored = check
          .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
          .get() as { value: string }
        if (original.value !== restored.value)
          throw new DriveError('BACKUP_WRONG_DATABASE')
        return check
          .prepare(
            'SELECT id,vault_id,owner_id,scope,revision,saved_at,payload,key_check FROM vault_history',
          )
          .all() as History[]
      },
    )
  }
  async function deliver() {
    const d = destination()
    if (!d || closed || (d.retry_at && d.retry_at > now())) return
    try {
      if (d.key_check !== checksum(currentKey()))
        throw new DriveError('BACKUP_KEY_CHANGED')
      const adapter = await store(d)
      const rows = db
        .prepare(
          "SELECT b.id,b.filename FROM backup_runs b LEFT JOIN backup_deliveries d ON d.backup_id=b.id AND d.folder_id=? WHERE b.status='verified' AND d.verified_at IS NULL ORDER BY b.created_at DESC LIMIT 3",
        )
        .all(d.folder_id) as { id: string; filename: string }[]
      for (const row of rows) {
        valid(d)
        if (!/^complete-\d+-[0-9a-f-]{36}\.lbx$/.test(row.filename))
          throw new DriveError('BACKUP_FILENAME_INVALID')
        const bytes = readFileSync(join(config.backupDirectory, row.filename)),
          hash = checksum(bytes)
        let record = db
          .prepare('SELECT * FROM backup_deliveries WHERE backup_id=?')
          .get(row.id) as Delivery | undefined
        if (!record) {
          const id = await adapter.allocate()
          valid(d)
          db.prepare(
            'INSERT INTO backup_deliveries(backup_id,folder_id,file_id,digest) VALUES(?,?,?,?)',
          ).run(row.id, d.folder_id, id, hash)
          record = {
            backup_id: row.id,
            folder_id: d.folder_id,
            file_id: id,
            digest: hash,
            verified_at: null,
          }
        }
        if (record.folder_id !== d.folder_id || record.digest !== hash)
          throw new DriveError('BACKUP_DESTINATION_CHANGED')
        db.prepare(
          'UPDATE backup_deliveries SET attempts=attempts+1,error=NULL WHERE backup_id=?',
        ).run(row.id)
        let remote: string | undefined
        try {
          remote = (await adapter.read(record.file_id, 'backup')).sealed
        } catch (error) {
          if (
            !(error instanceof DriveError) ||
            error.code !== 'DRIVE_FILE_NOT_FOUND'
          )
            throw error
        }
        if (!remote) {
          try {
            await adapter.create(
              record.file_id,
              'backup',
              hash,
              bytes.toString('utf8'),
            )
          } catch (error) {
            try {
              remote = (await adapter.read(record.file_id, 'backup')).sealed
            } catch {
              throw error
            }
          }
          remote ??= (await adapter.read(record.file_id, 'backup')).sealed
        }
        if (checksum(remote) !== hash)
          throw new DriveError('BACKUP_REMOTE_MISMATCH')
        verify(remote)
        valid(d)
        db.transaction(() => {
          db.prepare(
            'UPDATE backup_deliveries SET verified_at=?,error=NULL WHERE backup_id=?',
          ).run(now(), row.id)
          db.prepare(
            'UPDATE backup_destination SET last_success=?,last_error=NULL,retry_at=NULL WHERE id=1 AND folder_id=?',
          ).run(now(), d.folder_id)
        }).immediate()
      }
    } catch (error) {
      const code =
        error instanceof DriveError ? error.code : 'BACKUP_DELIVERY_FAILED'
      db.prepare(
        'UPDATE backup_destination SET last_error=?,retry_at=? WHERE id=1 AND folder_id=?',
      ).run(code, now() + 60000, d.folder_id)
      db.prepare(
        'UPDATE backup_deliveries SET error=? WHERE verified_at IS NULL',
      ).run(code)
    }
  }
  async function archive() {
    const d = destination()
    if (!d) throw new DriveError('BACKUP_NOT_CONFIGURED')
    const record = db
      .prepare(
        'SELECT * FROM backup_deliveries WHERE folder_id=? AND verified_at IS NOT NULL ORDER BY verified_at DESC LIMIT 1',
      )
      .get(d.folder_id) as Delivery | undefined
    if (!record) throw new DriveError('BACKUP_REMOTE_NOT_VERIFIED')
    const remote = (await (await store(d)).read(record.file_id, 'backup'))
      .sealed
    if (checksum(remote) !== record.digest)
      throw new DriveError('BACKUP_REMOTE_MISMATCH')
    const rows = verify(remote),
      policy = db
        .prepare('SELECT history_days FROM maintenance_policy WHERE id=1')
        .get() as { history_days: number }
    valid(d)
    db.transaction(() => {
      for (const h of rows) {
        if (h.saved_at >= now() - policy.history_days * 86400000) continue
        const live = db
          .prepare(
            'SELECT id,vault_id,owner_id,scope,revision,saved_at,payload,key_check FROM vault_history WHERE id=?',
          )
          .get(h.id) as History | undefined
        if (!live || digest(live) !== digest(h)) continue
        db.prepare(
          'INSERT INTO archived_history(id,vault_id,owner_id,scope,revision,saved_at,backup_id,digest) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
        ).run(
          h.id,
          h.vault_id,
          h.owner_id,
          h.scope,
          h.revision,
          h.saved_at,
          record.backup_id,
          digest(h),
        )
        db.prepare('DELETE FROM vault_history WHERE id=?').run(h.id)
      }
    }).immediate()
  }
  async function history(id: number) {
    const row = db
      .prepare(
        'SELECT a.*,d.file_id,d.folder_id,d.digest AS backup_digest FROM archived_history a JOIN backup_deliveries d ON d.backup_id=a.backup_id WHERE a.id=? AND d.verified_at IS NOT NULL',
      )
      .get(id) as
      | {
          file_id: string
          folder_id: string
          backup_digest: string
          digest: string
        }
      | undefined
    const d = destination()
    if (!row || !d || row.folder_id !== d.folder_id)
      throw new DriveError('BACKUP_ARCHIVE_UNAVAILABLE')
    const remote = (await (await store(d)).read(row.file_id, 'backup')).sealed
    if (checksum(remote) !== row.backup_digest)
      throw new DriveError('BACKUP_REMOTE_MISMATCH')
    const h = verify(remote).find((x) => x.id === id)
    if (!h || digest(h) !== row.digest)
      throw new DriveError('BACKUP_HISTORY_MISMATCH')
    return h
  }
  return {
    status,
    configure,
    history: (id: number) => exclusive(() => history(id)),
    archive: () => exclusive(archive),
    deliver() {
      if (!running && !closed && !ioBusy)
        running = exclusive(deliver).finally(() => {
          running = undefined
        })
      return running ?? Promise.resolve()
    },
    async close() {
      closed = true
      await running
    },
  }
}
export interface History {
  id: number
  vault_id: string
  owner_id: string
  scope: 'personal' | 'shared'
  revision: number
  saved_at: number
  payload: string
  key_check: string | null
}
export type OffdeviceService = ReturnType<typeof createOffdeviceService>
