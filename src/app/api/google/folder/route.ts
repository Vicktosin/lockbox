import { randomUUID } from 'node:crypto'
import {
  assertSameOrigin,
  driveError,
  googleErrorResponse,
  googleRequest,
  GoogleHttpError,
  readBearer,
  verifyGoogleIdentity,
} from '@/lib/server/google'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const fileIdPattern = /^[A-Za-z0-9_-]{10,150}$/

export async function GET(request: Request) {
  try {
    assertSameOrigin(request)
    const token = readBearer(request)
    await verifyGoogleIdentity(token)
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!fileIdPattern.test(id))
      throw new GoogleHttpError(400, 'DRIVE_FOLDER_INVALID')
    const response = await googleRequest(
      token,
      'https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(id) +
        '?fields=id%2Cname%2CmimeType%2Ctrashed%2Ccapabilities(canAddChildren)',
    )
    if (!response.ok) throw await driveError(response)
    const folder = (await response.json()) as {
      id?: string
      name?: string
      mimeType?: string
      trashed?: boolean
      capabilities?: { canAddChildren?: boolean }
    }
    if (
      folder.id !== id ||
      folder.mimeType !== 'application/vnd.google-apps.folder' ||
      folder.trashed ||
      folder.capabilities?.canAddChildren !== true
    )
      throw new GoogleHttpError(400, 'DRIVE_FOLDER_INVALID')
    return Response.json(
      { id, name: folder.name ?? 'Google Drive folder' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return googleErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, true)
    const token = readBearer(request)
    await verifyGoogleIdentity(token)
    const response = await googleRequest(
      token,
      'https://www.googleapis.com/drive/v3/files?fields=id%2Cname%2CmimeType%2Ccapabilities(canAddChildren)',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'LOCKBOX-' + randomUUID(),
          mimeType: 'application/vnd.google-apps.folder',
        }),
      },
    )
    if (!response.ok) throw await driveError(response)
    const folder = (await response.json()) as {
      id?: string
      name?: string
      mimeType?: string
      capabilities?: { canAddChildren?: boolean }
    }
    if (
      typeof folder.id !== 'string' ||
      !fileIdPattern.test(folder.id) ||
      folder.mimeType !== 'application/vnd.google-apps.folder' ||
      folder.capabilities?.canAddChildren !== true
    )
      throw new GoogleHttpError(502, 'DRIVE_FOLDER_CREATE_FAILED')
    return Response.json(
      { id: folder.id, name: folder.name ?? 'LOCKBOX' },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return googleErrorResponse(error)
  }
}
