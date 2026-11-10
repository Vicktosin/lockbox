import { createServer } from 'node:http'

/** Health-only development scaffold. No authentication simulation or request-body processing. */
export function createScaffoldServer() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    )
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200)
      response.end(
        JSON.stringify({
          status: 'scaffold',
          storage: 'disabled',
          authentication: 'not-implemented',
        }),
      )
      return
    }
    // All current/future API and OAuth routes remain unavailable, regardless of env values.
    response.writeHead(request.url?.startsWith('/api/') ? 503 : 404)
    response.end(
      JSON.stringify({
        code: request.url?.startsWith('/api/')
          ? 'INTEGRATION_NOT_IMPLEMENTED'
          : 'NOT_FOUND',
      }),
    )
  })
}
