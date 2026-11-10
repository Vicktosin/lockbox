import { AuthError } from './errors.ts'

/** Single-host bounded counters; no secrets logged/persisted; expired windows are reclaimed. */
export function createLimiter(now: () => number) {
  const buckets = new Map<string, { count: number; expires: number }>()
  const check = (key: string, limit: number, windowMs: number) => {
    const time = now()
    for (const [name, value] of buckets)
      if (value.expires <= time) buckets.delete(name)
    const current = buckets.get(key)
    if (current && current.count >= limit)
      throw new AuthError(
        429,
        'TRY_LATER',
        Math.max(1, Math.ceil((current.expires - time) / 1000)),
      )
    if (!current && buckets.size >= 10000)
      throw new AuthError(429, 'TRY_LATER', 60)
    buckets.set(
      key,
      current
        ? { ...current, count: current.count + 1 }
        : { count: 1, expires: time + windowMs },
    )
  }
  return Object.assign(check, { reset: (key: string) => buckets.delete(key) })
}
