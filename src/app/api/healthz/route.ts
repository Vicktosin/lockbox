import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { status: 'ok', runtime: 'nextjs', persistence: 'google-drive' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
