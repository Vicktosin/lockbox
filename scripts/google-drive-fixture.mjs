/** Test transport only. Production uses native fetch against fixed Google endpoints. */
export class GoogleFixture {
  folderId = '1PrivateFolderForLockboxTests'
  folderIds = new Set([this.folderId, '1PrivateBackupFolderForTests'])
  uploads = new Map()
  files = new Map()
  requests = []
  counter = 0
  refreshes = 0
  revocations = 0
  folderPublic = false
  folderWritable = true
  folderOwned = true
  failure = null
  onCreate = null
  beforeCreate = null
  onToken = null
  failAfterCreate = false
  invalidGrant = false
  json(value, status = 200, headers = {}) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }
  fetch = async (input, init = {}) => {
    const url = new URL(input),
      method = init.method ?? 'GET',
      headers = new Headers(init.headers)
    this.requests.push({
      url: url.href,
      method,
      headers: Object.fromEntries(headers),
      body: typeof init.body === 'string' ? init.body : init.body?.toString(),
    })
    if (
      url.origin === 'https://oauth2.googleapis.com' &&
      url.pathname === '/token'
    ) {
      const params = new URLSearchParams(init.body)
      if (this.onToken) await this.onToken(params)
      if (params.get('grant_type') === 'refresh_token') {
        this.refreshes++
        if (this.invalidGrant) return this.json({ error: 'invalid_grant' }, 400)
      }
      return this.json({
        access_token: 'fictional-google-access-token',
        refresh_token: 'fictional-google-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/drive',
      })
    }
    if (
      url.origin === 'https://oauth2.googleapis.com' &&
      url.pathname === '/revoke'
    ) {
      this.revocations++
      return this.json({})
    }
    if (url.origin !== 'https://www.googleapis.com')
      throw new Error('Unexpected test destination')
    if (this.failure) {
      const failed = this.failure(url, method)
      if (failed) return failed
    }
    if (headers.get('authorization') !== 'Bearer fictional-google-access-token')
      return this.json({ error: { code: 401 } }, 401)
    const path = url.pathname.replace(/^\/upload/, '')
    if (path === '/drive/v3/about')
      return this.json({
        user: { emailAddress: 'fictional-owner@example.test' },
      })
    if (path === '/drive/v3/files/generateIds')
      return this.json({
        ids: ['mock_file_' + String(++this.counter).padStart(8, '0')],
      })
    if (path === '/drive/v3/files' && method === 'GET') {
      const query = url.searchParams.get('q') ?? '',
        kind = /key='kind' and value='([^']+)'/.exec(query)?.[1],
        app = /key='lockboxApp' and value='([^']+)'/.exec(query)?.[1]
      const folder = /'([^']+)' in parents/.exec(query)?.[1]
      return this.json({
        files: [...this.files.values()]
          .filter(
            (file) =>
              !file.meta.trashed &&
              file.meta.parents.includes(folder ?? this.folderId) &&
              file.meta.appProperties.kind === kind &&
              file.meta.appProperties.lockboxApp === app,
          )
          .map((file) => file.meta),
      })
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      if (url.searchParams.get('uploadType') === 'resumable') {
        const meta = JSON.parse(String(init.body))
        if (this.files.has(meta.id))
          return this.json({ error: { code: 409 } }, 409)
        const uploadId = 'upload_' + String(++this.counter)
        this.uploads.set(uploadId, { meta, bytes: Buffer.alloc(0) })
        return this.json({}, 200, {
          location:
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' +
            uploadId,
        })
      }
      const boundary = /boundary=(.*)/.exec(headers.get('content-type'))[1],
        parts = String(init.body).split('--' + boundary)
      const meta = JSON.parse(parts[1].split('\r\n\r\n')[1].trim()),
        sealed = parts[2].split('\r\n\r\n')[1].trim()
      if (this.files.has(meta.id))
        return this.json({ error: { code: 409 } }, 409)
      if (this.beforeCreate) await this.beforeCreate(meta)
      meta.version = '1'
      meta.trashed = false
      this.files.set(meta.id, { meta, sealed })
      if (this.onCreate) await this.onCreate(meta)
      if (this.failAfterCreate) {
        this.failAfterCreate = false
        throw new Error('Simulated lost response after durable upload')
      }
      return this.json({ id: meta.id })
    }
    if (path === '/drive/v3/files' && method === 'PUT') {
      const upload = this.uploads.get(url.searchParams.get('upload_id'))
      if (!upload) return this.json({ error: { code: 404 } }, 404)
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        headers.get('content-range') ?? '',
      )
      if (!match) throw new Error('Invalid test Content-Range')
      const start = Number(match[1]),
        total = Number(match[3])
      if (start === upload.bytes.length)
        upload.bytes = Buffer.concat([upload.bytes, Buffer.from(init.body)])
      if (upload.bytes.length < total)
        return this.json({}, 308, {
          range: 'bytes=0-' + (upload.bytes.length - 1),
        })
      if (upload.bytes.length !== total)
        throw new Error('Invalid test upload length')
      const meta = upload.meta
      if (this.beforeCreate) await this.beforeCreate(meta)
      meta.version = '1'
      meta.trashed = false
      this.files.set(meta.id, { meta, sealed: upload.bytes.toString('utf8') })
      this.uploads.delete(url.searchParams.get('upload_id'))
      if (this.onCreate) await this.onCreate(meta)
      if (this.failAfterCreate) {
        this.failAfterCreate = false
        throw new Error('Simulated lost response after resumable upload')
      }
      return this.json({ id: meta.id })
    }
    const id = path.split('/').at(-1)
    if (this.folderIds.has(id))
      return this.json({
        id,
        name: 'Fictional private household folder',
        mimeType: 'application/vnd.google-apps.folder',
        ownedByMe: this.folderOwned,
        capabilities: { canAddChildren: this.folderWritable },
        permissions: [
          { type: 'user', role: 'owner' },
          ...(this.folderPublic ? [{ type: 'anyone', role: 'reader' }] : []),
        ],
      })
    const file = this.files.get(id)
    if (!file || file.meta.trashed)
      return this.json({ error: { code: 404 } }, 404)
    const etag = '"' + file.meta.version + '"'
    if (method === 'GET')
      return url.searchParams.get('alt') === 'media'
        ? new Response(file.sealed, {
            headers: { 'content-type': 'application/octet-stream' },
          })
        : this.json(file.meta, 200, { etag })
    if (method === 'PATCH') {
      if (headers.get('if-match') !== etag)
        return this.json({ error: { code: 412 } }, 412)
      if (url.pathname.startsWith('/upload')) file.sealed = String(init.body)
      else file.meta.trashed = JSON.parse(init.body).trashed
      file.meta.version = String(Number(file.meta.version) + 1)
      return this.json({ id }, 200, { etag: '"' + file.meta.version + '"' })
    }
    throw new Error('Unsupported test request ' + method + ' ' + path)
  }
}
