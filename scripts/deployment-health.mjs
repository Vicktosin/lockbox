// Service-manager readiness probe; emits no response bodies, tokens or configuration.
const port = process.env.LOCKBOX_BACKEND_PORT || '8787'
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  process.exit(1)
let healthy = false
// Monotonic startup deadline; separate from all request/authentication limits.
const deadline = performance.now() + 90000
while (performance.now() < deadline) {
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/healthz', {
      signal: AbortSignal.timeout(2000),
    })
    const body = await r.json()
    if (r.ok && body.database === 'ready') {
      healthy = true
      break
    }
  } catch {
    /* Startup may still be validating migrations and keys. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}
process.stdout.write(
  healthy ? 'Lockbox readiness verified.\n' : 'Lockbox readiness failed.\n',
)
process.exitCode = healthy ? 0 : 1
