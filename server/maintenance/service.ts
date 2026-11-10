import { readFileSync, readdirSync, rmSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Sqlite } from '../database/connection.ts'
import {
  createComplete,
  initializeEmergencyKey,
  type CompleteConfig,
  type DeploymentSecrets,
} from './complete.ts'
import { AuthError } from '../auth/errors.ts'
import type { OffdeviceService } from './offdevice.ts'

export interface MaintenanceOptions {
  config: CompleteConfig
  secrets?: DeploymentSecrets
  now?: () => number
  intervalMs?: number
  background?: boolean
  offdevice?: OffdeviceService
}
export function createMaintenanceService(
  db: Sqlite,
  options: MaintenanceOptions,
) {
  const now = options.now ?? Date.now
  const emergency = initializeEmergencyKey(
    options.config,
    Boolean(db.prepare('SELECT 1 FROM backup_destination LIMIT 1').get()),
  )
  let running: Promise<void> | undefined,
    timer: ReturnType<typeof setInterval> | undefined,
    lastError: string | null = null,
    closed = false
  const policy = () =>
    db
      .prepare(
        'SELECT backup_days,history_days FROM maintenance_policy WHERE id=1',
      )
      .get() as { backup_days: number; history_days: number }
  function status() {
    return {
      running: !!running,
      lastError,
      policy: policy(),
      offdevice: options.offdevice?.status() ?? null,
      backups: db
        .prepare(
          'SELECT created_at,verified_at,status FROM backup_runs ORDER BY created_at DESC LIMIT 10',
        )
        .all(),
      restore:
        db
          .prepare(
            "SELECT value FROM app_metadata WHERE name='complete_restore'",
          )
          .get() ?? null,
    }
  }
  async function perform() {
    const id = randomUUID()
    db.prepare(
      "INSERT INTO backup_runs(id,created_at,filename,status) VALUES(?,?,?,'running')",
    ).run(id, now(), 'pending')
    try {
      const result = await createComplete(
        options.config,
        options.secrets,
        now,
        Boolean(db.prepare('SELECT 1 FROM backup_destination LIMIT 1').get()),
      )
      db.prepare(
        "UPDATE backup_runs SET filename=?,verified_at=?,status='verified' WHERE id=?",
      ).run(result.filename, result.verifiedAt, id)
      lastError = null
      await options.offdevice?.deliver()
      // Delete only old verified complete bundles. Always keep the two most recent verified copies.
      const verified = db
        .prepare(
          "SELECT id,filename,created_at FROM backup_runs WHERE status='verified' ORDER BY created_at DESC",
        )
        .all() as { id: string; filename: string; created_at: number }[]
      const cutoff = now() - policy().backup_days * 86400000
      for (const row of verified.slice(2))
        if (
          row.created_at < cutoff &&
          /^complete-\d+-[0-9a-f-]{36}\.lbx$/.test(row.filename)
        ) {
          // Keep the local fallback too whenever it is the indexed archive for unique history.
          if (
            db
              .prepare(
                'SELECT 1 FROM archived_history WHERE backup_id=? LIMIT 1',
              )
              .get(row.id)
          )
            continue
          const delivery = db
            .prepare(
              'SELECT verified_at FROM backup_deliveries WHERE backup_id=?',
            )
            .get(row.id) as { verified_at: number | null } | undefined
          if (options.offdevice && !delivery?.verified_at) continue
          const path = join(options.config.backupDirectory, row.filename)
          if (
            readdirSync(options.config.backupDirectory).includes(row.filename)
          ) {
            if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
              continue
            rmSync(path)
          }
          if (!delivery)
            db.prepare('DELETE FROM backup_runs WHERE id=?').run(row.id)
        }
      // Exact duplicates alone can expire automatically; retain every unique encrypted revision.
      db.prepare(
        'DELETE FROM vault_history AS h WHERE saved_at<? AND EXISTS(SELECT 1 FROM vault_history newer WHERE newer.id>h.id AND newer.vault_id=h.vault_id AND newer.owner_id=h.owner_id AND newer.scope=h.scope AND newer.revision=h.revision AND newer.payload=h.payload AND newer.key_check IS h.key_check)',
      ).run(now() - policy().history_days * 86400000)
    } catch (error) {
      lastError =
        (error as { code?: string }).code === 'BACKUP_RECOVERY_CODES_REQUIRED'
          ? 'BACKUP_RECOVERY_CODES_REQUIRED'
          : 'BACKUP_FAILED'
      db.prepare("UPDATE backup_runs SET status='failed' WHERE id=?").run(id)
    }
  }
  return {
    status,
    backup() {
      if (closed) throw new AuthError(503, 'MAINTENANCE_CLOSED')
      if (!running)
        running = perform().finally(() => {
          running = undefined
        })
      return running
    },
    emergencyKey() {
      return readFileSync(emergency, 'utf8').trim()
    },
    setPolicy(backupDays: number, historyDays: number) {
      db.prepare(
        'UPDATE maintenance_policy SET backup_days=?,history_days=? WHERE id=1',
      ).run(backupDays, historyDays)
    },
    start() {
      if (timer) return
      const tick = () => {
        void options.offdevice?.deliver()
        const latest = db
          .prepare(
            "SELECT MAX(verified_at) AS t FROM backup_runs WHERE status='verified'",
          )
          .get() as { t: number | null }
        if (!latest.t || now() - latest.t >= 86400000) void this.backup()
      }
      tick()
      timer = setInterval(tick, options.intervalMs ?? 60000)
      timer.unref()
    },
    async close() {
      closed = true
      if (timer) clearInterval(timer)
      await running
      await options.offdevice?.close()
    },
  }
}
