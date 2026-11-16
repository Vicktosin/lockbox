import { DriveVaultService } from '@/lib/server/drive-vault'
import {
  assertSameOrigin,
  googleErrorResponse,
  GoogleHttpError,
  readBearer,
  verifyGoogleIdentity,
} from '@/lib/server/google'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

interface RouteContext {
  params: Promise<{ path: string[] }>
}

async function dispatch(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request, request.method !== 'GET')
    const token = readBearer(request)
    const identity = await verifyGoogleIdentity(token)
    const folderId = request.headers.get('x-lockbox-drive-folder') ?? ''
    if (!/^[A-Za-z0-9_-]{10,150}$/.test(folderId))
      throw new GoogleHttpError(400, 'DRIVE_FOLDER_REQUIRED')
    const { path } = await context.params
    const route = path.join('/')
    if (!/^[a-z/-]{1,80}$/.test(route))
      throw new GoogleHttpError(404, 'NOT_FOUND')

    let body: unknown
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        throw new GoogleHttpError(415, 'JSON_REQUIRED')
      const length = Number(request.headers.get('content-length') ?? 0)
      if (length > 2_100_000)
        throw new GoogleHttpError(413, 'REQUEST_TOO_LARGE')
      const text = await request.text()
      if (new TextEncoder().encode(text).length > 2_100_000)
        throw new GoogleHttpError(413, 'REQUEST_TOO_LARGE')
      try {
        body = JSON.parse(text)
      } catch {
        throw new GoogleHttpError(400, 'INVALID_REQUEST')
      }
    }

    const service = new DriveVaultService(token, identity, folderId)
    await service.validateFolder()
    return await service.handle(
      route,
      request.method,
      body,
      new URL(request.url).searchParams,
    )
  } catch (error) {
    return googleErrorResponse(error)
  }
}

export const GET = dispatch
export const POST = dispatch
