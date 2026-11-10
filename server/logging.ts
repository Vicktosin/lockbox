export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }
/** Deliberately allowlisted metadata: never serialize arbitrary errors/config/requests. */
export function createLogger(
  level: LogLevel = 'info',
  sink: (line: string) => void = (line) => process.stdout.write(line + '\n'),
) {
  return (
    severity: Exclude<LogLevel, 'silent'>,
    event: string,
    metadata: {
      code?: string
      durationMs?: number
      migrationVersion?: number
    } = {},
  ) => {
    if (levels[severity] < levels[level]) return
    const safe = {
      code: metadata.code?.match(/^[A-Z0-9_]{1,80}$/)?.[0],
      durationMs: Number.isFinite(metadata.durationMs)
        ? metadata.durationMs
        : undefined,
      migrationVersion: Number.isInteger(metadata.migrationVersion)
        ? metadata.migrationVersion
        : undefined,
    }
    sink(
      JSON.stringify({
        time: new Date().toISOString(),
        level: severity,
        event: /^[a-z0-9_.-]{1,80}$/.test(event) ? event : 'invalid_event',
        ...safe,
      }),
    )
  }
}
