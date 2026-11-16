export const dynamic = 'force-dynamic'

export function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const apiKey = process.env.GOOGLE_API_KEY?.trim() ?? ''
  const appId = process.env.GOOGLE_APP_ID?.trim() ?? ''
  const validClientId =
    /^[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
  const validApiKey = /^AIza[A-Za-z0-9_-]{20,}$/.test(apiKey)
  const validAppId = /^[0-9]{6,}$/.test(appId)

  return Response.json(
    {
      configured: validClientId && validApiKey && validAppId,
      clientId: validClientId ? clientId : null,
      apiKey: validApiKey ? apiKey : null,
      appId: validAppId ? appId : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
