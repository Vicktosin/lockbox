import { randomBytes } from 'node:crypto'
import { check, ProofError } from './errors.mjs'
import { readResponse } from './oauth.mjs'
const base = 'https://www.googleapis.com/drive/v3/'
const fileId = (value) => {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{10,150}$/.test(value))
  return value
}
export class NativeDrive {
  constructor(
    connection,
    {
      fetch: run = fetch,
      sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    } = {},
  ) {
    this.connection = connection
    this.fetch = run
    this.sleep = sleep
  }
  async request(
    path,
    { method = 'GET', body, headers = {}, upload = false } = {},
  ) {
    const url =
      (upload ? 'https://www.googleapis.com/upload/drive/v3/' : base) + path
    for (let attempt = 0; attempt < 4; attempt++) {
      let response
      try {
        response = await this.fetch(url, {
          method,
          body,
          redirect: 'error',
          headers: {
            ...headers,
            Authorization:
              'Bearer ' +
              (await this.connection.access(
                attempt > 0 && this.unauthorized === true,
              )),
          },
          signal: AbortSignal.timeout(15000),
        })
      } catch (error) {
        if (error instanceof ProofError) throw error
        if (attempt === 3) throw new ProofError('PROOF_NETWORK_UNAVAILABLE')
        await this.sleep(250 * 2 ** attempt)
        continue
      }
      this.unauthorized = response.status === 401
      if (response.ok) return response
      if (
        (response.status === 401 ||
          response.status === 429 ||
          response.status >= 500) &&
        attempt < 3
      ) {
        await response.body?.cancel()
        await this.sleep(250 * 2 ** attempt)
        continue
      }
      const code =
        response.status === 403
          ? 'PROOF_GOOGLE_FOLDER_PERMISSION_REQUIRED'
          : response.status === 404
            ? 'PROOF_CLOUD_DATA_MISSING'
            : response.status === 409
              ? 'PROOF_CLOUD_FILE_EXISTS'
              : 'PROOF_GOOGLE_REQUEST_FAILED'
      await response.body?.cancel()
      throw new ProofError(code)
    }
  }
  async json(path, options) {
    return readResponse(await this.request(path, options))
  }
  async account() {
    const value = await this.json(
      'about?fields=user(permissionId,emailAddress)',
    )
    check(
      typeof value.user?.permissionId === 'string' &&
        typeof value.user.emailAddress === 'string',
      'PROOF_GOOGLE_IDENTITY_INVALID',
    )
    return value.user
  }
  async folder(name, parent) {
    check(
      /^LOCKBOX-PROOF-[A-Z-]+-[a-f0-9-]{36}$/.test(name),
      'PROOF_FICTIONAL_FOLDER_REQUIRED',
    )
    return this.json('files?fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parent ? { parents: [fileId(parent)] } : {}),
      }),
    })
  }
  async validateFolder(id, allowed) {
    const folder = await this.json(
      'files/' +
        fileId(id) +
        '?fields=id,name,mimeType,trashed,capabilities(canAddChildren)',
    )
    check(
      folder.name?.startsWith('LOCKBOX-PROOF-') &&
        folder.mimeType === 'application/vnd.google-apps.folder' &&
        !folder.trashed &&
        folder.capabilities?.canAddChildren,
      'PROOF_FOLDER_INVALID',
    )
    const permissions = await this.json(
      'files/' +
        fileId(id) +
        '/permissions?fields=permissions(id,type,role,emailAddress)&pageSize=100',
    )
    check(Array.isArray(permissions.permissions), 'PROOF_FOLDER_INVALID')
    for (const p of permissions.permissions)
      check(
        p.type === 'user' &&
          allowed.some(
            (a) =>
              a.permissionId === p.id ||
              a.emailAddress.toLowerCase() === p.emailAddress?.toLowerCase(),
          ),
        'PROOF_FOLDER_PERMISSION_CHANGED',
      )
    return folder
  }
  async grant(folder, person) {
    check(
      typeof person.emailAddress === 'string' &&
        person.emailAddress.length < 300,
    )
    await this.json(
      'files/' +
        fileId(folder) +
        '/permissions?sendNotificationEmail=false&fields=id',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'user',
          role: 'writer',
          emailAddress: person.emailAddress,
        }),
      },
    )
  }
  async allocate() {
    const data = await this.json(
      'files/generateIds?count=1&space=drive&type=files',
    )
    check(Array.isArray(data.ids) && data.ids.length === 1)
    return fileId(data.ids[0])
  }
  async list(folder) {
    let page = '',
      result = []
    do {
      const q =
        "'" +
        fileId(folder) +
        "' in parents and trashed=false and appProperties has {key='lockboxProof' and value='v1'}"
      const value = await this.json(
        'files?' +
          new URLSearchParams({
            q,
            fields: 'nextPageToken,files(id,parents,appProperties)',
            pageSize: '100',
            ...(page ? { pageToken: page } : {}),
          }),
      )
      check(Array.isArray(value.files))
      result.push(...value.files)
      check(result.length <= 256, 'PROOF_HISTORY_LIMIT')
      page = value.nextPageToken ?? ''
    } while (page)
    return result
  }
  async read(id, folder) {
    const meta = await this.json(
      'files/' + fileId(id) + '?fields=id,parents,trashed,appProperties',
    )
    check(
      !meta.trashed &&
        meta.parents?.length === 1 &&
        meta.parents[0] === folder &&
        meta.appProperties?.lockboxProof === 'v1',
      'PROOF_FILE_OUTSIDE_NAMESPACE',
    )
    return readResponse(
      await this.request('files/' + fileId(id) + '?alt=media'),
    )
  }
  async create(id, folder, packet) {
    const boundary = 'lockbox-' + randomBytes(20).toString('hex'),
      metadata = {
        id: fileId(id),
        name: 'lockbox-proof-' + id + '.json',
        parents: [fileId(folder)],
        appProperties: { lockboxProof: 'v1' },
      },
      text = JSON.stringify(packet)
    check(Buffer.byteLength(text) < 1500000, 'PROOF_RESPONSE_LIMIT')
    const body =
      '--' +
      boundary +
      '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      '\r\n--' +
      boundary +
      '\r\nContent-Type: application/json\r\n\r\n' +
      text +
      '\r\n--' +
      boundary +
      '--\r\n'
    await this.json('files?uploadType=multipart&fields=id', {
      method: 'POST',
      upload: true,
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body,
    })
  }
}
