import { randomBytes } from 'node:crypto'
import { DriveError } from './security.ts'
export type Transport = typeof fetch
export interface FileMeta {
  id: string
  name?: string
  version: string
  parents?: string[]
  trashed?: boolean
  appProperties?: Record<string, string>
}
export interface EncryptedFileStore {
  validateFolder(): Promise<{ id: string; name: string }>
  account(): Promise<string>
  allocate(): Promise<string>
  list(kind: 'snapshot' | 'commit' | 'backup'): Promise<FileMeta[]>
  create(
    id: string,
    kind: 'snapshot' | 'commit' | 'backup',
    hash: string,
    sealed: string,
  ): Promise<void>
  read(
    id: string,
    kind: 'snapshot' | 'commit' | 'backup',
  ): Promise<{ sealed: string; meta: FileMeta; etag: string | null }>
  update(
    id: string,
    kind: 'snapshot' | 'commit' | 'backup',
    sealed: string,
    etag: string,
  ): Promise<void>
  trash(
    id: string,
    kind: 'snapshot' | 'commit' | 'backup',
    etag: string,
  ): Promise<void>
}
export interface DriveAdapterOptions {
  folderId: string
  resourceKey: string | null
  appId: string
  token: (force?: boolean) => Promise<string>
  fetch?: Transport
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}
export async function readJson(
  response: Response,
  max = 4000000,
): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > max)
    throw new DriveError('DRIVE_RESPONSE_TOO_LARGE')
  const reader = response.body?.getReader()
  if (!reader) throw new DriveError('DRIVE_RESPONSE_INVALID')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > max) throw new DriveError('DRIVE_RESPONSE_TOO_LARGE')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (error instanceof DriveError) throw error
    throw new DriveError('DRIVE_RESPONSE_INVALID')
  }
}
export class GoogleDriveAdapter implements EncryptedFileStore {
  private options: DriveAdapterOptions
  constructor(options: DriveAdapterOptions) {
    if (
      !/^[A-Za-z0-9_-]{10,200}$/.test(options.folderId) ||
      !/^[0-9a-f-]{36}$/.test(options.appId)
    )
      throw new DriveError('DRIVE_FOLDER_LINK_INVALID')
    this.options = options
  }
  private async request(
    path: string,
    init: RequestInit = {},
    upload = false,
  ): Promise<Response> {
    const run = this.options.fetch ?? fetch
    let force = false
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.options.signal?.aborted)
        throw new DriveError('DRIVE_DISCONNECTED')
      try {
        const token = await this.options.token(force)
        force = false
        const response = await run(
          'https://www.googleapis.com/' +
            (upload ? 'upload/drive/v3/' : 'drive/v3/') +
            path,
          {
            ...init,
            redirect: 'error',
            signal: AbortSignal.any([
              AbortSignal.timeout(12000),
              ...(this.options.signal ? [this.options.signal] : []),
            ]),
            headers: {
              Authorization: 'Bearer ' + token,
              ...(this.options.resourceKey
                ? {
                    'X-Goog-Drive-Resource-Keys':
                      this.options.folderId + '/' + this.options.resourceKey,
                  }
                : {}),
              ...init.headers,
            },
          },
        )
        if (response.ok || (response.status === 308 && init.method === 'PUT'))
          return response
        if (response.status === 401 && attempt === 0) {
          await response.body?.cancel()
          force = true
          continue
        }
        if (response.status === 412)
          throw new DriveError('DRIVE_PRECONDITION_FAILED')
        if (response.status === 409) throw new DriveError('DRIVE_OBJECT_EXISTS')
        if (response.status === 404)
          throw new DriveError('DRIVE_FILE_NOT_FOUND')
        let retry = response.status === 429 || response.status >= 500
        if (response.status === 403) {
          const data = (await readJson(response, 16384)) as {
            error?: { errors?: { reason?: string }[] }
          }
          retry = Boolean(
            data.error?.errors?.some((error) =>
              ['rateLimitExceeded', 'userRateLimitExceeded'].includes(
                error.reason ?? '',
              ),
            ),
          )
        } else await response.body?.cancel()
        if (!retry)
          throw new DriveError(
            response.status === 401
              ? 'DRIVE_RECONNECT_REQUIRED'
              : 'DRIVE_ACCESS_DENIED',
          )
        if (attempt === 3)
          throw new DriveError('DRIVE_TEMPORARILY_UNAVAILABLE', true)
      } catch (error) {
        if (error instanceof DriveError) throw error
        if (attempt === 3) throw new DriveError('DRIVE_NETWORK_ERROR', true)
      }
      await (
        this.options.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      )(1000 * 2 ** attempt + Math.floor(Math.random() * 250))
    }
    throw new DriveError('DRIVE_NETWORK_ERROR', true)
  }
  async validateFolder() {
    const data = (await readJson(
      await this.request(
        'files/' +
          this.options.folderId +
          '?fields=id,name,mimeType,trashed,ownedByMe,driveId,capabilities(canAddChildren),permissions(type,role)',
      ),
      65536,
    )) as {
      id: string
      name: string
      mimeType: string
      trashed?: boolean
      ownedByMe?: boolean
      driveId?: string
      capabilities?: { canAddChildren?: boolean }
      permissions?: { type: string; role: string }[]
    }
    if (
      data.id !== this.options.folderId ||
      data.mimeType !== 'application/vnd.google-apps.folder' ||
      data.trashed ||
      data.driveId ||
      !data.ownedByMe ||
      !data.capabilities?.canAddChildren
    )
      throw new DriveError('DRIVE_FOLDER_NOT_WRITABLE')
    if (
      !data.permissions?.length ||
      data.permissions.some(
        (permission) =>
          permission.type !== 'user' || permission.role !== 'owner',
      )
    )
      throw new DriveError('DRIVE_FOLDER_NOT_PRIVATE')
    if (typeof data.name !== 'string' || data.name.length > 255)
      throw new DriveError('DRIVE_RESPONSE_INVALID')
    return { id: data.id, name: data.name }
  }
  async account() {
    const data = (await readJson(
      await this.request('about?fields=user(emailAddress)'),
      16384,
    )) as { user?: { emailAddress?: string } }
    const email = data.user?.emailAddress
    if (typeof email !== 'string' || email.length > 254 || !email.includes('@'))
      throw new DriveError('DRIVE_ACCOUNT_UNAVAILABLE')
    return email
  }
  async allocate() {
    const data = (await readJson(
      await this.request('files/generateIds?count=1&space=drive&type=files'),
      16384,
    )) as { ids?: string[] }
    const id = data.ids?.[0]
    if (!id || !/^[A-Za-z0-9_-]{5,200}$/.test(id))
      throw new DriveError('DRIVE_RESPONSE_INVALID')
    return id
  }
  async list(kind: 'snapshot' | 'commit' | 'backup') {
    const result: FileMeta[] = []
    const seenPages = new Set<string>()
    let page = ''
    do {
      if (seenPages.has(page) || seenPages.size >= 100)
        throw new DriveError('DRIVE_HISTORY_TOO_LARGE')
      seenPages.add(page)
      const q = `'${this.options.folderId}' in parents and trashed = false and appProperties has { key='lockboxApp' and value='${this.options.appId}' } and appProperties has { key='kind' and value='${kind}' }`
      const params = new URLSearchParams({
        q,
        fields:
          'nextPageToken,files(id,name,version,parents,trashed,appProperties)',
        pageSize: '1000',
        spaces: 'drive',
        ...(page ? { pageToken: page } : {}),
      })
      const data = (await readJson(
        await this.request('files?' + params),
        2000000,
      )) as { files?: FileMeta[]; nextPageToken?: string }
      if (
        !Array.isArray(data.files) ||
        result.length + data.files.length > 10000
      )
        throw new DriveError('DRIVE_HISTORY_TOO_LARGE')
      result.push(...data.files)
      page = data.nextPageToken ?? ''
      if (page.length > 4096) throw new DriveError('DRIVE_RESPONSE_INVALID')
    } while (page)
    return result
  }
  private check(meta: FileMeta, kind: string) {
    if (
      meta.trashed ||
      !meta.parents?.includes(this.options.folderId) ||
      meta.appProperties?.lockboxApp !== this.options.appId ||
      meta.appProperties?.kind !== kind
    )
      throw new DriveError('DRIVE_FILE_OUTSIDE_NAMESPACE')
  }
  async read(id: string, kind: 'snapshot' | 'commit' | 'backup') {
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(id))
      throw new DriveError('DRIVE_FILE_INVALID')
    const metaResponse = await this.request(
        'files/' + id + '?fields=id,version,parents,trashed,appProperties',
      ),
      meta = (await readJson(metaResponse, 16384)) as FileMeta
    this.check(meta, kind)
    const response = await this.request('files/' + id + '?alt=media')
    const value = (await readJson(
      response,
      kind === 'backup' ? 90000000 : 4000000,
    )) as unknown
    if (!value || typeof value !== 'object')
      throw new DriveError('DRIVE_RESPONSE_INVALID')
    return {
      sealed: JSON.stringify(value),
      meta,
      etag: metaResponse.headers.get('etag'),
    }
  }
  async create(
    id: string,
    kind: 'snapshot' | 'commit' | 'backup',
    hash: string,
    sealed: string,
  ) {
    const boundary = 'lockbox_' + randomBytes(16).toString('hex'),
      metadata = {
        id,
        name:
          'lockbox-' +
          kind +
          '-' +
          (kind === 'backup' ? Date.now() + '-' : '') +
          hash +
          '.lbenc',
        mimeType: 'application/octet-stream',
        parents: [this.options.folderId],
        appProperties: {
          lockboxApp: this.options.appId,
          kind,
          hash,
          format: '1',
        },
      }
    if (kind === 'backup') {
      const bytes = Buffer.from(sealed)
      if (bytes.length > 90000000)
        throw new DriveError('DRIVE_RESPONSE_TOO_LARGE')
      const initiated = await this.request(
        'files?uploadType=resumable&fields=id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'application/octet-stream',
            'X-Upload-Content-Length': String(bytes.length),
          },
          body: JSON.stringify(metadata),
        },
        true,
      )
      const location = initiated.headers.get('location')
      await initiated.body?.cancel()
      if (!location) throw new DriveError('DRIVE_RESPONSE_INVALID')
      const url = new URL(location)
      if (
        url.origin !== 'https://www.googleapis.com' ||
        url.username ||
        url.password ||
        url.pathname !== '/upload/drive/v3/files' ||
        url.searchParams.get('uploadType') !== 'resumable' ||
        !url.searchParams.get('upload_id')
      )
        throw new DriveError('DRIVE_RESPONSE_INVALID')
      let offset = 0
      while (offset < bytes.length) {
        const end = Math.min(offset + 1024 * 1024, bytes.length)
        const response = await this.request(
          'files' + url.search,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}`,
            },
            body: bytes.subarray(offset, end),
          },
          true,
        )
        if (response.status === 308) {
          const match = /^bytes=0-(\d+)$/.exec(
            response.headers.get('range') ?? '',
          )
          await response.body?.cancel()
          const next = match ? Number(match[1]) + 1 : 0
          if (next <= offset || next > end || next >= bytes.length)
            throw new DriveError('DRIVE_RESPONSE_INVALID')
          offset = next
        } else {
          const result = (await readJson(response, 16384)) as { id?: string }
          if (end !== bytes.length || result.id !== id)
            throw new DriveError('DRIVE_RESPONSE_INVALID')
          return
        }
      }
      throw new DriveError('DRIVE_RESPONSE_INVALID')
    }
    const body =
      '--' +
      boundary +
      '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      '\r\n--' +
      boundary +
      '\r\nContent-Type: application/octet-stream\r\n\r\n' +
      sealed +
      '\r\n--' +
      boundary +
      '--'
    const response = await this.request(
      'files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body,
      },
      true,
    )
    const created = (await readJson(response, 16384)) as { id?: string }
    if (created.id !== id) throw new DriveError('DRIVE_RESPONSE_INVALID')
  }
  async update(
    id: string,
    kind: 'snapshot' | 'commit' | 'backup',
    sealed: string,
    etag: string,
  ) {
    const current = await this.read(id, kind)
    if (!etag || !current.etag || etag !== current.etag)
      throw new DriveError('DRIVE_PRECONDITION_FAILED')
    await this.request(
      'files/' + id + '?uploadType=media',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          'If-Match': etag,
        },
        body: sealed,
      },
      true,
    )
  }
  async trash(
    id: string,
    kind: 'snapshot' | 'commit' | 'backup',
    etag: string,
  ) {
    const current = await this.read(id, kind)
    if (!etag || !current.etag || etag !== current.etag)
      throw new DriveError('DRIVE_PRECONDITION_FAILED')
    await this.request('files/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify({ trashed: true }),
    })
  }
}
