import { randomUUID } from 'node:crypto'
import type {
  Envelope,
  StoredProfile,
  StoredVault,
  VaultProfile,
  VaultState,
} from '../../../shared/client-vault.ts'
import {
  driveError,
  googleRequest,
  GoogleHttpError,
  type GoogleDriveIdentity,
} from './google.ts'

const driveBase = 'https://www.googleapis.com/drive/v3'
const uploadBase = 'https://www.googleapis.com/upload/drive/v3'
const accountName = 'lockbox-account-v1.json'
const householdName = 'lockbox-household-v1.json'
const maxDriveFileBytes = 10 * 1024 * 1024
const historyLimit = 12

interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  trashed?: boolean
}

interface FileSnapshot<T> {
  id: string
  etag: string
  value: T
}

interface HistoryRecord extends StoredVault {
  historyId: number
  savedAt: number
}

interface PendingMove {
  id: string
  personalRevision: number
  personalPayload: Envelope
  householdRevision: number
  householdPayload: Envelope
}

interface PendingRevoke {
  id: string
  userId: string
  profileRevision: number
  profile: VaultProfile
  householdRevision: number
  payload: Envelope
  check: Envelope
}

interface AccountDocument {
  v: 1
  profile: StoredProfile | null
  personal: StoredVault | null
  history: HistoryRecord[]
  pendingMove?: PendingMove
  pendingRevoke?: PendingRevoke
}

interface HouseholdMember {
  id: string
  email: string
  access: 'invited' | 'joined'
}

interface HouseholdDocument {
  v: 1
  id: string
  ownerId: string
  ownerEmail: string
  revision: number
  payload: Envelope
  check: Envelope
  members: HouseholdMember[]
  history: HistoryRecord[]
}

interface FileList {
  files?: DriveFile[]
}

const emptyAccount = (): AccountDocument => ({
  v: 1,
  profile: null,
  personal: null,
  history: [],
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value)) return false
  return (
    value.v === 1 &&
    value.alg === 'XChaCha20-Poly1305' &&
    typeof value.nonce === 'string' &&
    /^[A-Za-z0-9+/]{32}$/.test(value.nonce) &&
    typeof value.ciphertext === 'string' &&
    value.ciphertext.length >= 24 &&
    value.ciphertext.length <= 900_000 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.ciphertext,
    )
  )
}

function validProfile(value: unknown): value is VaultProfile {
  if (!isRecord(value) || !isRecord(value.kdf)) return false
  const kdf = value.kdf
  return (
    value.v === 1 &&
    kdf.name === 'Argon2id' &&
    kdf.memory === 65536 &&
    kdf.iterations === 3 &&
    kdf.parallelism === 1 &&
    typeof kdf.salt === 'string' &&
    /^[A-Za-z0-9+/]{22}==$/.test(kdf.salt) &&
    validEnvelope(value.master) &&
    validEnvelope(value.recovery) &&
    validEnvelope(value.keyring)
  )
}

function validVault(value: unknown): value is StoredVault {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    /^[A-Za-z0-9:_-]{1,255}$/.test(value.id) &&
    (value.scope === 'personal' || value.scope === 'shared') &&
    typeof value.ownerId === 'string' &&
    /^[A-Za-z0-9_-]{1,255}$/.test(value.ownerId) &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    validEnvelope(value.payload) &&
    (value.check === null || validEnvelope(value.check))
  )
}

function accountDocument(value: unknown): AccountDocument {
  if (!isRecord(value) || value.v !== 1)
    throw new GoogleHttpError(502, 'DRIVE_ACCOUNT_DATA_INVALID')
  if (
    (value.profile !== null &&
      (!isRecord(value.profile) ||
        !Number.isSafeInteger(value.profile.revision) ||
        !validProfile(value.profile.data))) ||
    (value.personal !== null && !validVault(value.personal)) ||
    !Array.isArray(value.history) ||
    value.history.length > historyLimit ||
    (value.pendingMove !== undefined &&
      (!isRecord(value.pendingMove) ||
        typeof value.pendingMove.id !== 'string' ||
        !Number.isSafeInteger(value.pendingMove.personalRevision) ||
        !Number.isSafeInteger(value.pendingMove.householdRevision) ||
        !validEnvelope(value.pendingMove.personalPayload) ||
        !validEnvelope(value.pendingMove.householdPayload))) ||
    (value.pendingRevoke !== undefined &&
      (!isRecord(value.pendingRevoke) ||
        typeof value.pendingRevoke.id !== 'string' ||
        typeof value.pendingRevoke.userId !== 'string' ||
        !Number.isSafeInteger(value.pendingRevoke.profileRevision) ||
        !Number.isSafeInteger(value.pendingRevoke.householdRevision) ||
        !validProfile(value.pendingRevoke.profile) ||
        !validEnvelope(value.pendingRevoke.payload) ||
        !validEnvelope(value.pendingRevoke.check)))
  )
    throw new GoogleHttpError(502, 'DRIVE_ACCOUNT_DATA_INVALID')
  for (const item of value.history)
    if (!isHistoryRecord(item))
      throw new GoogleHttpError(502, 'DRIVE_ACCOUNT_DATA_INVALID')
  return value as unknown as AccountDocument
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.historyId) &&
    Number.isSafeInteger(value.savedAt) &&
    validVault(value)
  )
}

function householdDocument(value: unknown): HouseholdDocument {
  if (!isRecord(value) || typeof value.ownerEmail !== 'string')
    throw new GoogleHttpError(502, 'DRIVE_HOUSEHOLD_DATA_INVALID')
  const ownerEmail = value.ownerEmail
  if (
    value.v !== 1 ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.id) ||
    typeof value.ownerId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(value.ownerId) ||
    typeof value.ownerEmail !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.ownerEmail) ||
    value.ownerEmail.length > 320 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !validEnvelope(value.payload) ||
    !validEnvelope(value.check) ||
    !Array.isArray(value.members) ||
    value.members.length > 20 ||
    !Array.isArray(value.history) ||
    value.history.length > historyLimit
  )
    throw new GoogleHttpError(502, 'DRIVE_HOUSEHOLD_DATA_INVALID')
  for (const member of value.members)
    if (
      !isRecord(member) ||
      typeof member.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(member.id) ||
      member.id.length > 255 ||
      typeof member.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email) ||
      member.email.length > 320 ||
      (member.access !== 'invited' && member.access !== 'joined')
    )
      throw new GoogleHttpError(502, 'DRIVE_HOUSEHOLD_DATA_INVALID')
  if (
    new Set(value.members.map((member) => member.id)).size !==
      value.members.length ||
    new Set(value.members.map((member) => member.email.toLowerCase())).size !==
      value.members.length ||
    value.members.some(
      (member) => member.email.toLowerCase() === ownerEmail.toLowerCase(),
    )
  )
    throw new GoogleHttpError(502, 'DRIVE_HOUSEHOLD_DATA_INVALID')
  for (const item of value.history)
    if (!isHistoryRecord(item))
      throw new GoogleHttpError(502, 'DRIVE_HOUSEHOLD_DATA_INVALID')
  return value as unknown as HouseholdDocument
}

function jsonResponse<T>(value: T) {
  return Response.json(value, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export class DriveVaultService {
  private readonly token: string
  private readonly identity: GoogleDriveIdentity
  private readonly folderId: string

  constructor(token: string, identity: GoogleDriveIdentity, folderId: string) {
    this.token = token
    this.identity = identity
    this.folderId = folderId
  }

  async validateFolder() {
    const { value: folder } = await this.json<{
      id?: string
      mimeType?: string
      trashed?: boolean
      capabilities?: { canAddChildren?: boolean }
    }>(
      `${driveBase}/files/${encodeURIComponent(this.folderId)}?fields=id%2CmimeType%2Ctrashed%2Ccapabilities(canAddChildren)`,
    )
    if (
      folder.id !== this.folderId ||
      folder.mimeType !== 'application/vnd.google-apps.folder' ||
      folder.trashed ||
      folder.capabilities?.canAddChildren !== true
    )
      throw new GoogleHttpError(403, 'DRIVE_FOLDER_PERMISSION_REQUIRED')
  }

  async prepare() {
    let account = await this.account()
    if (account.value.pendingMove) {
      await this.finishPendingMove(account.value.pendingMove.id)
      account = await this.account()
    }
    if (account.value.pendingRevoke)
      await this.finishPendingRevoke(account.value.pendingRevoke.id)
  }

  private async json<T>(
    url: string,
    init?: RequestInit,
  ): Promise<{ value: T; etag: string }> {
    let response: Response
    try {
      response = await googleRequest(this.token, url, init)
    } catch {
      throw new GoogleHttpError(502, 'GOOGLE_DRIVE_TEMPORARILY_UNAVAILABLE')
    }
    if (!response.ok) throw await driveError(response)
    const etag = response.headers.get('etag') ?? ''
    const value = (await response.json()) as T
    return { value, etag }
  }

  private async readContent<T>(id: string) {
    let response: Response
    try {
      response = await googleRequest(
        this.token,
        `${driveBase}/files/${encodeURIComponent(id)}?alt=media`,
      )
    } catch {
      throw new GoogleHttpError(502, 'GOOGLE_DRIVE_TEMPORARILY_UNAVAILABLE')
    }
    if (!response.ok) throw await driveError(response)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > maxDriveFileBytes) {
      await response.body?.cancel()
      throw new GoogleHttpError(413, 'DRIVE_FILE_TOO_LARGE')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new GoogleHttpError(502, 'DRIVE_FILE_INVALID')
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch {
        throw new GoogleHttpError(502, 'GOOGLE_DRIVE_TEMPORARILY_UNAVAILABLE')
      }
      if (result.done) break
      total += result.value.byteLength
      if (total > maxDriveFileBytes) {
        await reader.cancel().catch(() => undefined)
        throw new GoogleHttpError(413, 'DRIVE_FILE_TOO_LARGE')
      }
      chunks.push(result.value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new GoogleHttpError(502, 'DRIVE_FILE_INVALID')
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new GoogleHttpError(502, 'DRIVE_FILE_INVALID')
    }
  }

  private async list(
    query: string,
    spaces?: 'appDataFolder',
  ): Promise<DriveFile[]> {
    const parameters = new URLSearchParams({
      q: query,
      fields: 'files(id,name,mimeType,parents,trashed)',
      pageSize: '10',
      ...(spaces ? { spaces } : {}),
    })
    const { value } = await this.json<FileList>(
      `${driveBase}/files?${parameters.toString()}`,
    )
    if (!Array.isArray(value.files) || value.files.length > 10)
      throw new GoogleHttpError(502, 'DRIVE_FILE_LIST_INVALID')
    return value.files
  }

  private async findAccount(): Promise<FileSnapshot<AccountDocument> | null> {
    const files = await this.list(
      `name='${accountName}' and trashed=false`,
      'appDataFolder',
    )
    if (files.length > 1)
      throw new GoogleHttpError(409, 'DRIVE_ACCOUNT_FILE_CONFLICT')
    if (!files.length) return null
    const file = files[0]
    if (
      !file.id ||
      file.name !== accountName ||
      file.mimeType !== 'application/json' ||
      file.trashed
    )
      throw new GoogleHttpError(502, 'DRIVE_ACCOUNT_FILE_INVALID')
    const meta = await this.json<DriveFile>(
      `${driveBase}/files/${encodeURIComponent(file.id)}?fields=id%2Cname%2CmimeType%2Cparents%2Ctrashed`,
    )
    if (
      meta.value.id !== file.id ||
      meta.value.name !== accountName ||
      meta.value.mimeType !== 'application/json' ||
      meta.value.trashed
    )
      throw new GoogleHttpError(502, 'DRIVE_ACCOUNT_FILE_INVALID')
    if (!meta.etag)
      throw new GoogleHttpError(502, 'DRIVE_CONCURRENCY_UNAVAILABLE')
    return {
      id: file.id,
      etag: meta.etag,
      value: accountDocument(await this.readContent(file.id)),
    }
  }

  private async findHousehold(): Promise<FileSnapshot<HouseholdDocument> | null> {
    const files = await this.list(
      `'${this.folderId}' in parents and name='${householdName}' and trashed=false`,
    )
    if (files.length > 1)
      throw new GoogleHttpError(409, 'DRIVE_HOUSEHOLD_FILE_CONFLICT')
    if (!files.length) return null
    const file = files[0]
    if (
      !file.id ||
      file.name !== householdName ||
      file.mimeType !== 'application/json' ||
      file.trashed ||
      !file.parents?.includes(this.folderId)
    )
      throw new GoogleHttpError(502, 'DRIVE_HOUSEHOLD_FILE_INVALID')
    const meta = await this.json<DriveFile>(
      `${driveBase}/files/${encodeURIComponent(file.id)}?fields=id%2Cname%2CmimeType%2Cparents%2Ctrashed`,
    )
    if (
      meta.value.id !== file.id ||
      meta.value.name !== householdName ||
      meta.value.mimeType !== 'application/json' ||
      meta.value.trashed ||
      !meta.value.parents?.includes(this.folderId)
    )
      throw new GoogleHttpError(502, 'DRIVE_HOUSEHOLD_FILE_INVALID')
    if (!meta.etag)
      throw new GoogleHttpError(502, 'DRIVE_CONCURRENCY_UNAVAILABLE')
    return {
      id: file.id,
      etag: meta.etag,
      value: householdDocument(await this.readContent(file.id)),
    }
  }

  private async createFile<T>(name: string, value: T, appData: boolean) {
    const boundary = 'lockbox-' + randomUUID()
    const metadata = {
      name,
      mimeType: 'application/json',
      parents: [appData ? 'appDataFolder' : this.folderId],
    }
    const text = JSON.stringify(value)
    if (new TextEncoder().encode(text).length > maxDriveFileBytes)
      throw new GoogleHttpError(413, 'DRIVE_FILE_TOO_LARGE')
    const body =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      text +
      `\r\n--${boundary}--\r\n`
    const { value: file } = await this.json<DriveFile>(
      `${uploadBase}/files?uploadType=multipart&fields=id%2Cname%2CmimeType%2Cparents`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    )
    if (
      typeof file.id !== 'string' ||
      file.name !== name ||
      file.mimeType !== 'application/json' ||
      (appData
        ? !file.parents?.includes('appDataFolder')
        : !file.parents?.includes(this.folderId))
    )
      throw new GoogleHttpError(502, 'DRIVE_FILE_CREATE_FAILED')
    const snapshot = await this.findById<T>(file.id)
    if (!snapshot) throw new GoogleHttpError(502, 'DRIVE_FILE_CREATE_FAILED')
    return snapshot
  }

  private async findById<T>(id: string): Promise<FileSnapshot<T> | null> {
    const meta = await this.json<DriveFile>(
      `${driveBase}/files/${encodeURIComponent(id)}?fields=id%2Cname%2CmimeType%2Cparents%2Ctrashed`,
    )
    if (
      meta.value.id !== id ||
      meta.value.trashed ||
      (meta.value.name === accountName
        ? meta.value.parents?.includes('appDataFolder') !== true
        : !meta.value.parents?.includes(this.folderId))
    )
      throw new GoogleHttpError(502, 'DRIVE_FILE_OUTSIDE_NAMESPACE')
    if (!meta.etag)
      throw new GoogleHttpError(502, 'DRIVE_CONCURRENCY_UNAVAILABLE')
    return { id, etag: meta.etag, value: await this.readContent<T>(id) }
  }

  private async writeFile<T>(
    snapshot: FileSnapshot<T>,
    value: T,
  ): Promise<FileSnapshot<T>> {
    const next = structuredClone(value)
    let text = JSON.stringify(next)
    if (isRecord(next) && Array.isArray(next.history)) {
      while (
        new TextEncoder().encode(text).length > maxDriveFileBytes &&
        next.history.length > 0
      ) {
        next.history.pop()
        text = JSON.stringify(next)
      }
    }
    if (new TextEncoder().encode(text).length > maxDriveFileBytes)
      throw new GoogleHttpError(413, 'DRIVE_FILE_TOO_LARGE')
    let response: Response
    try {
      response = await googleRequest(
        this.token,
        `${uploadBase}/files/${encodeURIComponent(snapshot.id)}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'If-Match': snapshot.etag,
          },
          body: text,
        },
      )
    } catch {
      throw new GoogleHttpError(502, 'GOOGLE_DRIVE_TEMPORARILY_UNAVAILABLE')
    }
    if (!response.ok) throw await driveError(response)
    await response.body?.cancel()
    const updated = await this.findById<T>(snapshot.id)
    if (!updated) throw new GoogleHttpError(502, 'DRIVE_FILE_UPDATE_FAILED')
    return updated
  }

  private async account(): Promise<FileSnapshot<AccountDocument>> {
    const found = await this.findAccount()
    if (found) {
      const personal = found.value.personal
      if (
        personal &&
        (personal.scope !== 'personal' ||
          personal.ownerId !== this.identity.id ||
          personal.id !== 'personal:' + this.identity.id)
      )
        throw new GoogleHttpError(502, 'DRIVE_ACCOUNT_DATA_INVALID')
      return found
    }
    return this.createFile(accountName, emptyAccount(), true)
  }

  private async household(): Promise<FileSnapshot<HouseholdDocument> | null> {
    return this.findHousehold()
  }

  private recordHistory(document: AccountDocument, vault: StoredVault) {
    const historyId = Date.now() * 1000 + Math.floor(Math.random() * 500)
    document.history = [
      { ...vault, historyId, savedAt: Date.now() },
      ...document.history,
    ].slice(0, historyLimit)
  }

  private recordHouseholdHistory(
    document: HouseholdDocument,
    vault: StoredVault,
  ) {
    const historyId = Date.now() * 1000 + 500 + Math.floor(Math.random() * 500)
    document.history = [
      { ...vault, historyId, savedAt: Date.now() },
      ...document.history,
    ].slice(0, historyLimit)
  }

  private async state(): Promise<VaultState> {
    const account = await this.account()
    const storedHousehold = await this.household()
    const hasHouseholdAccess =
      storedHousehold?.value.ownerId === this.identity.id ||
      storedHousehold?.value.members.some(
        (member) =>
          member.email.toLowerCase() === this.identity.email.toLowerCase(),
      )
    const household = hasHouseholdAccess ? storedHousehold : null
    return {
      profile: account.value.profile,
      personal: account.value.personal,
      household: household
        ? {
            id: household.value.id,
            scope: 'shared',
            ownerId: household.value.ownerId,
            revision: household.value.revision,
            payload: household.value.payload,
            check: household.value.check,
            joined:
              household.value.ownerId === this.identity.id ||
              household.value.members.some(
                (member) =>
                  member.email.toLowerCase() ===
                    this.identity.email.toLowerCase() &&
                  member.access === 'joined',
              ),
          }
        : null,
      candidates:
        household?.value.ownerId === this.identity.id
          ? household.value.members.map((member) => ({
              id: member.id,
              username: member.email,
              access: member.access,
            }))
          : [],
    }
  }

  async handle(
    path: string,
    method: string,
    body: unknown,
    query: URLSearchParams,
  ) {
    await this.prepare()
    if (path === 'state' && method === 'GET')
      return jsonResponse(await this.state())
    if (path === 'history' && method === 'GET')
      return jsonResponse(await this.history(query.get('id')))
    if (method !== 'POST' || !isRecord(body))
      throw new GoogleHttpError(404, 'NOT_FOUND')

    switch (path) {
      case 'setup':
        return jsonResponse(await this.setup(body))
      case 'profile':
        return jsonResponse(await this.updateProfile(body))
      case 'personal':
        return jsonResponse(await this.savePersonal(body))
      case 'household/create':
        return jsonResponse(await this.createHousehold(body))
      case 'household/grant':
        return jsonResponse(await this.grantHousehold(body))
      case 'household/join':
        return jsonResponse(await this.joinHousehold(body))
      case 'household/save':
        return jsonResponse(await this.saveHousehold(body))
      case 'household/revoke':
        return jsonResponse(await this.revokeHousehold(body))
      case 'move':
        return jsonResponse(await this.move(body))
      default:
        throw new GoogleHttpError(404, 'NOT_FOUND')
    }
  }

  private async setup(body: Record<string, unknown>) {
    if (!validProfile(body.profile) || !validEnvelope(body.payload))
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const account = await this.account()
    if (account.value.profile || account.value.personal)
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')
    const value: AccountDocument = {
      ...account.value,
      profile: { revision: 1, data: body.profile },
      personal: {
        id: 'personal:' + this.identity.id,
        scope: 'personal',
        ownerId: this.identity.id,
        revision: 1,
        payload: body.payload,
        check: null,
      },
    }
    await this.writeFile(account, value)
    return this.state()
  }

  private async updateProfile(body: Record<string, unknown>) {
    if (
      !validProfile(body.profile) ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 1
    )
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const account = await this.account()
    const current = account.value.profile
    if (!current || current.revision !== body.revision)
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')
    const value = {
      ...account.value,
      profile: { revision: current.revision + 1, data: body.profile },
    }
    await this.writeFile(account, value)
    return this.state()
  }

  private async savePersonal(body: Record<string, unknown>) {
    if (
      !validEnvelope(body.payload) ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 1
    )
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const account = await this.account()
    const current = account.value.personal
    if (!current || current.revision !== body.revision)
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')
    this.recordHistory(account.value, current)
    const value = {
      ...account.value,
      personal: {
        ...current,
        revision: current.revision + 1,
        payload: body.payload,
      },
    }
    await this.writeFile(account, value)
    return this.state()
  }

  private async createHousehold(body: Record<string, unknown>) {
    if (
      !validProfile(body.profile) ||
      !validEnvelope(body.payload) ||
      !validEnvelope(body.check) ||
      typeof body.id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(body.id) ||
      !Number.isSafeInteger(body.revision)
    )
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const account = await this.account()
    const profile = account.value.profile
    if (!profile || profile.revision !== body.revision)
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')
    const existing = await this.household()
    if (
      existing &&
      (existing.value.ownerId !== this.identity.id ||
        existing.value.id !== body.id ||
        existing.value.revision !== 1 ||
        existing.value.members.length !== 0 ||
        JSON.stringify(existing.value.payload) !==
          JSON.stringify(body.payload) ||
        JSON.stringify(existing.value.check) !== JSON.stringify(body.check))
    )
      throw new GoogleHttpError(409, 'HOUSEHOLD_ALREADY_EXISTS')
    const created =
      existing ??
      (await this.createFile<HouseholdDocument>(
        householdName,
        {
          v: 1,
          id: body.id,
          ownerId: this.identity.id,
          ownerEmail: this.identity.email,
          revision: 1,
          payload: body.payload,
          check: body.check,
          members: [],
          history: [],
        },
        false,
      ))
    householdDocument(created.value)
    const updatedAccount = {
      ...account.value,
      profile: { revision: profile.revision + 1, data: body.profile },
    }
    await this.writeFile(account, updatedAccount)
    return this.state()
  }

  private async grantHousehold(body: Record<string, unknown>) {
    const email =
      typeof body.userId === 'string' ? body.userId.trim().toLowerCase() : ''
    if (
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email === this.identity.email.toLowerCase()
    )
      throw new GoogleHttpError(400, 'HOUSEHOLD_EMAIL_INVALID')
    const household = await this.household()
    if (!household || household.value.ownerId !== this.identity.id)
      throw new GoogleHttpError(403, 'HOUSEHOLD_OWNER_REQUIRED')
    const existing = household.value.members.find(
      (member) => member.email.toLowerCase() === email,
    )
    if (existing) return this.state()

    const permissionsResponse = await this.json<{
      permissions?: Array<{
        id?: string
        type?: string
        role?: string
        emailAddress?: string
      }>
    }>(
      `${driveBase}/files/${encodeURIComponent(this.folderId)}/permissions?fields=permissions(id%2Ctype%2Crole%2CemailAddress)&pageSize=100`,
    )
    const permission = permissionsResponse.value.permissions?.find(
      (item) =>
        item.type === 'user' &&
        item.emailAddress?.toLowerCase() === email &&
        ['writer', 'organizer', 'owner'].includes(item.role ?? ''),
    )
    let permissionId = permission?.id
    if (!permissionId) {
      const response = await this.json<{ id?: string }>(
        `${driveBase}/files/${encodeURIComponent(this.folderId)}/permissions?sendNotificationEmail=true&fields=id`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'user',
            role: 'writer',
            emailAddress: email,
          }),
        },
      )
      permissionId = response.value.id
    }
    if (!permissionId || !/^[A-Za-z0-9_-]{1,255}$/.test(permissionId))
      throw new GoogleHttpError(502, 'HOUSEHOLD_INVITATION_FAILED')

    const next = householdDocument({
      ...household.value,
      members: [
        ...household.value.members,
        { id: permissionId, email, access: 'invited' },
      ],
    })
    await this.writeFile(household, next)
    return this.state()
  }

  private async joinHousehold(body: Record<string, unknown>) {
    if (
      !validProfile(body.profile) ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 1
    )
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const [account, household] = await Promise.all([
      this.account(),
      this.household(),
    ])
    if (!household) throw new GoogleHttpError(404, 'HOUSEHOLD_NOT_FOUND')
    const member = household.value.members.find(
      (candidate) =>
        candidate.email.toLowerCase() === this.identity.email.toLowerCase(),
    )
    if (!member) throw new GoogleHttpError(403, 'HOUSEHOLD_ACCESS_NOT_GRANTED')
    const profile = account.value.profile
    if (!profile || profile.revision !== body.revision)
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')
    const changed = householdDocument({
      ...household.value,
      members: household.value.members.map((candidate) =>
        candidate.email.toLowerCase() === this.identity.email.toLowerCase()
          ? { ...candidate, access: 'joined' as const }
          : candidate,
      ),
    })
    await this.writeFile(account, {
      ...account.value,
      profile: { revision: profile.revision + 1, data: body.profile },
    })
    await this.writeFile(household, changed)
    return this.state()
  }

  private async saveHousehold(body: Record<string, unknown>) {
    if (
      !validEnvelope(body.payload) ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 1
    )
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const household = await this.household()
    if (!household) throw new GoogleHttpError(404, 'HOUSEHOLD_NOT_FOUND')
    const member = household.value.members.find(
      (candidate) =>
        candidate.email.toLowerCase() === this.identity.email.toLowerCase(),
    )
    if (
      household.value.ownerId !== this.identity.id &&
      member?.access !== 'joined'
    )
      throw new GoogleHttpError(403, 'HOUSEHOLD_ACCESS_NOT_GRANTED')
    if (household.value.revision !== body.revision)
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')
    this.recordHouseholdHistory(household.value, {
      id: household.value.id,
      scope: 'shared',
      ownerId: household.value.ownerId,
      revision: household.value.revision,
      payload: household.value.payload,
      check: household.value.check,
    })
    await this.writeFile(
      household,
      householdDocument({
        ...household.value,
        revision: household.value.revision + 1,
        payload: body.payload,
      }),
    )
    return this.state()
  }

  private async revokeHousehold(body: Record<string, unknown>) {
    if (
      !validProfile(body.profile) ||
      !validEnvelope(body.payload) ||
      !validEnvelope(body.check) ||
      typeof body.userId !== 'string' ||
      !Number.isSafeInteger(body.revision) ||
      !Number.isSafeInteger(body.profileRevision)
    )
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const [account, household] = await Promise.all([
      this.account(),
      this.household(),
    ])
    if (!household || household.value.ownerId !== this.identity.id)
      throw new GoogleHttpError(403, 'HOUSEHOLD_OWNER_REQUIRED')
    const member = household.value.members.find(
      (candidate) => candidate.id === body.userId,
    )
    if (!member) throw new GoogleHttpError(404, 'HOUSEHOLD_MEMBER_NOT_FOUND')
    const profile = account.value.profile
    if (
      !profile ||
      profile.revision !== body.profileRevision ||
      household.value.revision !== body.revision
    )
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')
    await this.writeFile(account, {
      ...account.value,
      pendingRevoke: {
        id: randomUUID(),
        userId: body.userId,
        profileRevision: profile.revision,
        profile: body.profile,
        householdRevision: household.value.revision,
        payload: body.payload,
        check: body.check,
      },
    })
    const staged = await this.account()
    const transaction = staged.value.pendingRevoke
    if (!transaction) throw new GoogleHttpError(409, 'DRIVE_REVISION_CONFLICT')
    await this.finishPendingRevoke(transaction.id)
    return this.state()
  }

  private async move(body: Record<string, unknown>) {
    if (
      !validEnvelope(body.personal) ||
      !validEnvelope(body.shared) ||
      !Number.isSafeInteger(body.personalRevision) ||
      !Number.isSafeInteger(body.sharedRevision)
    )
      throw new GoogleHttpError(400, 'INVALID_REQUEST')
    const [account, household] = await Promise.all([
      this.account(),
      this.household(),
    ])
    if (!account.value.personal || !household)
      throw new GoogleHttpError(404, 'HOUSEHOLD_NOT_FOUND')
    const membership = household.value.members.find(
      (member) =>
        member.email.toLowerCase() === this.identity.email.toLowerCase(),
    )
    if (
      household.value.ownerId !== this.identity.id &&
      membership?.access !== 'joined'
    )
      throw new GoogleHttpError(403, 'HOUSEHOLD_ACCESS_NOT_GRANTED')
    if (
      account.value.personal.revision !== body.personalRevision ||
      household.value.revision !== body.sharedRevision
    )
      throw new GoogleHttpError(409, 'VAULT_CONFLICT')

    const transactionId = randomUUID()
    const pending: PendingMove = {
      id: transactionId,
      personalRevision: body.personalRevision as number,
      personalPayload: body.personal,
      householdRevision: body.sharedRevision as number,
      householdPayload: body.shared,
    }
    await this.writeFile(account, { ...account.value, pendingMove: pending })
    await this.finishPendingMove(transactionId)
    return this.state()
  }

  private async finishPendingMove(expectedId: string) {
    let account = await this.account()
    const pending = account.value.pendingMove
    if (!pending || pending.id !== expectedId) {
      if (!pending) return
      throw new GoogleHttpError(409, 'DRIVE_MOVE_CONFLICT')
    }
    const household = await this.household()
    if (!household) throw new GoogleHttpError(404, 'HOUSEHOLD_NOT_FOUND')
    if (household.value.revision === pending.householdRevision) {
      this.recordHouseholdHistory(household.value, {
        id: household.value.id,
        scope: 'shared',
        ownerId: household.value.ownerId,
        revision: household.value.revision,
        payload: household.value.payload,
        check: household.value.check,
      })
      await this.writeFile(
        household,
        householdDocument({
          ...household.value,
          revision: household.value.revision + 1,
          payload: pending.householdPayload,
        }),
      )
    } else if (
      household.value.revision !== pending.householdRevision + 1 ||
      JSON.stringify(household.value.payload) !==
        JSON.stringify(pending.householdPayload)
    )
      throw new GoogleHttpError(409, 'DRIVE_MOVE_CONFLICT')

    account = await this.account()
    if (account.value.pendingMove?.id !== expectedId)
      throw new GoogleHttpError(409, 'DRIVE_MOVE_CONFLICT')
    const personal = account.value.personal
    if (!personal)
      throw new GoogleHttpError(404, 'DRIVE_PERSONAL_VAULT_MISSING')
    if (personal.revision === pending.personalRevision) {
      this.recordHistory(account.value, personal)
      await this.writeFile(account, {
        ...account.value,
        personal: {
          ...personal,
          revision: personal.revision + 1,
          payload: pending.personalPayload,
        },
        pendingMove: undefined,
      })
    } else if (
      personal.revision !== pending.personalRevision + 1 ||
      JSON.stringify(personal.payload) !==
        JSON.stringify(pending.personalPayload)
    )
      throw new GoogleHttpError(409, 'DRIVE_MOVE_CONFLICT')
    else
      await this.writeFile(account, {
        ...account.value,
        pendingMove: undefined,
      })
  }

  private async finishPendingRevoke(expectedId: string) {
    let account = await this.account()
    const pending = account.value.pendingRevoke
    if (!pending || pending.id !== expectedId) {
      if (!pending) return
      throw new GoogleHttpError(409, 'DRIVE_REVISION_CONFLICT')
    }
    const household = await this.household()
    if (!household) throw new GoogleHttpError(404, 'HOUSEHOLD_NOT_FOUND')
    const member = household.value.members.find(
      (candidate) => candidate.id === pending.userId,
    )
    if (household.value.revision === pending.householdRevision && member) {
      this.recordHouseholdHistory(household.value, {
        id: household.value.id,
        scope: 'shared',
        ownerId: household.value.ownerId,
        revision: household.value.revision,
        payload: household.value.payload,
        check: household.value.check,
      })
      await this.writeFile(
        household,
        householdDocument({
          ...household.value,
          revision: household.value.revision + 1,
          payload: pending.payload,
          check: pending.check,
          members: household.value.members.filter(
            (candidate) => candidate.id !== pending.userId,
          ),
        }),
      )
    } else if (
      household.value.revision !== pending.householdRevision + 1 ||
      member ||
      JSON.stringify(household.value.payload) !==
        JSON.stringify(pending.payload) ||
      JSON.stringify(household.value.check) !== JSON.stringify(pending.check)
    )
      throw new GoogleHttpError(409, 'DRIVE_REVISION_CONFLICT')

    account = await this.account()
    const currentProfile = account.value.profile
    if (!currentProfile)
      throw new GoogleHttpError(404, 'DRIVE_ACCOUNT_PROFILE_MISSING')
    if (currentProfile.revision === pending.profileRevision) {
      await this.writeFile(account, {
        ...account.value,
        profile: {
          revision: currentProfile.revision + 1,
          data: pending.profile,
        },
      })
    } else if (
      currentProfile.revision !== pending.profileRevision + 1 ||
      JSON.stringify(currentProfile.data) !== JSON.stringify(pending.profile)
    )
      throw new GoogleHttpError(409, 'DRIVE_REVISION_CONFLICT')

    const permissionResponse = await googleRequest(
      this.token,
      `${driveBase}/files/${encodeURIComponent(this.folderId)}/permissions/${encodeURIComponent(pending.userId)}`,
      { method: 'DELETE' },
    )
    if (!permissionResponse.ok && permissionResponse.status !== 404)
      throw await driveError(permissionResponse)
    await permissionResponse.body?.cancel()

    account = await this.account()
    if (account.value.pendingRevoke?.id === expectedId)
      await this.writeFile(account, {
        ...account.value,
        pendingRevoke: undefined,
      })
  }

  private async history(id: string | null) {
    const [account, household] = await Promise.all([
      this.account(),
      this.household(),
    ])
    const sharedHistoryVisible =
      household?.value.ownerId === this.identity.id ||
      household?.value.members.some(
        (member) =>
          member.email.toLowerCase() === this.identity.email.toLowerCase(),
      )
    const all = [
      ...account.value.history,
      ...(sharedHistoryVisible ? (household?.value.history ?? []) : []),
    ].sort((a, b) => b.historyId - a.historyId)
    if (id !== null) {
      if (!/^[1-9][0-9]{0,15}$/.test(id))
        throw new GoogleHttpError(400, 'INVALID_REQUEST')
      const record = all.find((item) => item.historyId === Number(id))
      if (!record) throw new GoogleHttpError(404, 'HISTORY_NOT_FOUND')
      return { vault: record }
    }
    return {
      history: all.map((record) => ({
        id: record.historyId,
        scope: record.scope,
        revision: record.revision,
        saved_at: record.savedAt,
      })),
    }
  }
}
