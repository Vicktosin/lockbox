import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Sqlite } from '../database/connection.ts'
import type { LoadedKeys } from '../security/key-file.ts'
import type { ActiveSession } from '../auth/service.ts'
import type { DriveStatus } from '../../shared/drive.ts'
import type { GoogleApplication } from './config.ts'
import {
  GoogleDriveAdapter,
  readJson,
  type EncryptedFileStore,
  type Transport,
} from './provider.ts'
import {
  canonical,
  createSealer,
  digest,
  DriveError,
  parseFolder,
  stateDigest,
} from './security.ts'
import {
  exportSnapshots,
  hashes,
  importSnapshots,
  validateSnapshot,
  type Snapshot,
  type SnapshotSet,
} from './snapshots.ts'

const scope = 'https://www.googleapis.com/auth/drive'
interface Tokens {
  access: string
  refresh: string
  expires: number
}
interface Connection {
  epoch: string
  owner_id: string
  status: 'disconnected' | 'connected' | 'reauth-required'
  folder_id: string
  folder_name: string
  resource_key: string | null
  account_email: string
  tokens: string | null
  last_sync: number | null
  last_error: string | null
  retry_at: number | null
  lease_owner: string | null
  lease_until: number | null
}
interface Reference {
  namespace: string
  hash: string
  id: string
}
interface Commit {
  v: 1
  appId: string
  parents: string[]
  snapshots: Reference[]
  createdAt: number
  mutationId: string
}
interface Head {
  hash: string
  commit: Commit
}
interface Conflict {
  localHash: string
  heads: Head[]
  required: string[]
  approvals: Record<string, string>
}
export interface DriveOptions {
  keys: LoadedKeys
  application: GoogleApplication | null
  fetch?: Transport
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  adapter?: (
    connection: Connection,
    token: (force?: boolean) => Promise<string>,
  ) => EncryptedFileStore
  pollInterval?: number
  background?: boolean
}
export function createDriveService(db: Sqlite, options: DriveOptions) {
  const now = options.now ?? Date.now,
    run = options.fetch ?? fetch
  const appId = (
    db
      .prepare("SELECT value FROM app_metadata WHERE name='database_id'")
      .get() as { value: string }
  ).value
  const sealer = createSealer(options.keys, appId)
  let controller = new AbortController(),
    refreshing: Promise<string> | null = null,
    refreshEpoch = '',
    syncing: Promise<boolean> | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    interval: ReturnType<typeof setInterval> | undefined,
    closed = false,
    started = false
  const connection = () =>
    db.prepare('SELECT * FROM drive_connection WHERE id=1').get() as
      Connection | undefined
  const check = (epoch: string) => {
    const row = connection()
    if (!row || row.epoch !== epoch || row.status !== 'connected' || closed)
      throw new DriveError('DRIVE_DISCONNECTED')
    return row
  }
  const safeError = (error: unknown) =>
    error instanceof DriveError ? error.code : 'DRIVE_OPERATION_FAILED'
  const recordError = (error: unknown) => {
    const code = safeError(error)
    db.prepare(
      'UPDATE drive_connection SET last_error=?,retry_at=? WHERE id=1',
    ).run(
      code,
      error instanceof DriveError && error.temporary ? now() + 30000 : null,
    )
  }
  const requireAdmin = (session: ActiveSession) => {
    if (session.user.role !== 'administrator')
      throw new DriveError('DRIVE_ADMINISTRATOR_REQUIRED')
  }
  const application = () => {
    if (!options.application)
      throw new DriveError('DRIVE_APPLICATION_NOT_CONFIGURED')
    return options.application
  }
  async function tokenRequest(body: URLSearchParams) {
    let response: Response
    try {
      response = await run('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(12000),
      })
    } catch {
      throw new DriveError('DRIVE_NETWORK_ERROR', true)
    }
    const data = (await readJson(response, 65536)) as Record<string, unknown>
    if (!response.ok) {
      if (data.error === 'invalid_grant')
        throw new DriveError('DRIVE_RECONNECT_REQUIRED')
      throw new DriveError(
        response.status >= 500
          ? 'DRIVE_TEMPORARILY_UNAVAILABLE'
          : 'DRIVE_AUTHORIZATION_FAILED',
        response.status >= 500,
      )
    }
    return data
  }
  function parseTokens(
    data: Record<string, unknown>,
    oldRefresh?: string,
  ): Tokens {
    if (
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      data.access_token.length > 8192 ||
      data.token_type !== 'Bearer' ||
      typeof data.expires_in !== 'number' ||
      data.expires_in < 60 ||
      data.expires_in > 86400
    )
      throw new DriveError('DRIVE_AUTHORIZATION_FAILED')
    const refresh =
      typeof data.refresh_token === 'string' ? data.refresh_token : oldRefresh
    if (!refresh || refresh.length > 8192)
      throw new DriveError('DRIVE_OFFLINE_ACCESS_REQUIRED')
    if (
      data.scope !== undefined &&
      (typeof data.scope !== 'string' || !data.scope.split(' ').includes(scope))
    )
      throw new DriveError('DRIVE_PERMISSION_REQUIRED')
    return {
      access: data.access_token,
      refresh,
      expires: now() + data.expires_in * 1000,
    }
  }
  async function access(epoch: string, force = false): Promise<string> {
    application()
    const row = check(epoch)
    if (!row.tokens) throw new DriveError('DRIVE_RECONNECT_REQUIRED')
    const token = sealer.open<Tokens>(row.tokens, 'tokens:' + epoch)
    if (!force && token.expires > now() + 60000) return token.access
    if (refreshing && refreshEpoch === epoch) return refreshing
    refreshEpoch = epoch
    refreshing = (async () => {
      try {
        const config = application()
        const data = await tokenRequest(
          new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: token.refresh,
          }),
        )
        const updated = parseTokens(data, token.refresh)
        check(epoch)
        db.prepare(
          'UPDATE drive_connection SET tokens=? WHERE id=1 AND epoch=?',
        ).run(sealer.seal(updated, 'tokens:' + epoch), epoch)
        return updated.access
      } catch (error) {
        if (safeError(error) === 'DRIVE_RECONNECT_REQUIRED')
          db.prepare(
            "UPDATE drive_connection SET status='reauth-required',tokens=NULL,last_error='DRIVE_RECONNECT_REQUIRED' WHERE id=1 AND epoch=?",
          ).run(epoch)
        throw error
      } finally {
        if (refreshEpoch === epoch) refreshing = null
      }
    })()
    return refreshing
  }
  const adapter = (row: Connection) =>
    options.adapter?.(row, (force) => access(row.epoch, force)) ??
    new GoogleDriveAdapter({
      folderId: row.folder_id,
      resourceKey: row.resource_key,
      appId,
      fetch: options.fetch,
      sleep: options.sleep,
      signal: controller.signal,
      token: (force) => access(row.epoch, force),
    })
  const context = (folder: string, kind: string) =>
    'cloud:' + folder + ':' + kind
  function rememberConflict(row: Connection, heads: Head[]) {
    const localHash = digest(exportSnapshots(db)),
      previous = db
        .prepare(
          'SELECT id,sealed FROM drive_conflicts WHERE folder_id=? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
        .get(row.folder_id) as { id: string; sealed: string } | undefined
    if (previous) {
      const old = sealer.open<Conflict>(
        previous.sealed,
        'conflict:' + previous.id,
      )
      if (
        old.localHash === localHash &&
        canonical(old.heads.map((head) => head.hash)) ===
          canonical(heads.map((head) => head.hash))
      )
        return previous.id
    }
    const id = randomUUID(),
      required = (
        db.prepare('SELECT id FROM users ORDER BY id').all() as { id: string }[]
      ).map((value) => value.id)
    if (!required.includes(row.owner_id)) required.push(row.owner_id)
    db.prepare(
      'UPDATE drive_conflicts SET resolved_at=? WHERE folder_id=? AND resolved_at IS NULL',
    ).run(now(), row.folder_id)
    db.prepare(
      'INSERT INTO drive_conflicts(id,folder_id,created_at,sealed) VALUES(?,?,?,?)',
    ).run(
      id,
      row.folder_id,
      now(),
      sealer.seal(
        { localHash, heads, required, approvals: {} } satisfies Conflict,
        'conflict:' + id,
      ),
    )
    db.prepare(
      "UPDATE drive_connection SET last_error='DRIVE_CONFLICT',retry_at=NULL WHERE id=1 AND epoch=?",
    ).run(row.epoch)
    return id
  }
  function status(session: ActiveSession, signInAgain = false): DriveStatus {
    const row = connection(),
      conflict = row
        ? (db
            .prepare(
              'SELECT id,created_at,sealed FROM drive_conflicts WHERE folder_id=? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1',
            )
            .get(row.folder_id) as
            { id: string; created_at: number; sealed: string } | undefined)
        : undefined
    const details = conflict
      ? sealer.open<Conflict>(conflict.sealed, 'conflict:' + conflict.id)
      : null
    const snapshots = exportSnapshots(db),
      administrator = session.user.role === 'administrator'
    const checkpoint = row
        ? (db
            .prepare('SELECT hashes FROM drive_checkpoints WHERE folder_id=?')
            .get(row.folder_id) as { hashes: string } | undefined)
        : undefined,
      base = checkpoint
        ? (JSON.parse(checkpoint.hashes) as Record<string, string>)
        : {}
    return {
      configured: Boolean(options.application),
      connected: Boolean(options.application) && row?.status === 'connected',
      state: options.application
        ? (row?.status ?? 'disconnected')
        : 'disconnected',
      administrator,
      account: administrator ? (row?.account_email ?? null) : null,
      folder: row?.folder_id
        ? {
            id: row.folder_id,
            name: row.folder_name || 'Selected Google Drive folder',
          }
        : null,
      lastSync: row?.last_sync ?? null,
      error: row?.last_error ?? null,
      retryAt: row?.retry_at ?? null,
      syncing: Boolean(
        syncing || (row?.lease_until && row.lease_until > now()),
      ),
      conflict:
        conflict && details
          ? {
              id: conflict.id,
              createdAt: conflict.created_at,
              cloudCopies: details.heads.map((head) => ({
                hash: head.hash,
                createdAt: head.commit.createdAt,
              })),
              canResolve: details.required.includes(session.user.id),
              approvedCopy: details.approvals[session.user.id] ?? null,
              waitingForOthers: details.required.some(
                (id) => !details.approvals[id],
              ),
            }
          : null,
      namespaces: Object.entries(snapshots)
        .filter(
          ([, value]) =>
            administrator ||
            (value.kind === 'personal' && value.userId === session.user.id) ||
            (value.kind === 'household' &&
              value.members.some(
                (member) => member.userId === session.user.id,
              )),
        )
        .map(([namespace, value]) => ({
          namespace,
          label:
            value.kind === 'household'
              ? 'Shared Household Vault'
              : value.userId === session.user.id
                ? 'My Personal Vault'
                : 'Partner’s Personal Vault',
          revision: value.vault.revision,
          lastSync:
            base[namespace] === digest(value) ? (row?.last_sync ?? null) : null,
        })),
      ...(signInAgain ? { signInAgain: true } : {}),
    }
  }
  async function begin(session: ActiveSession, link: string) {
    requireAdmin(session)
    const config = application(),
      folder = parseFolder(link)
    if (connection()?.status === 'connected')
      throw new DriveError('DRIVE_ALREADY_CONNECTED')
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url'),
      hash = stateDigest(state),
      epoch = randomUUID()
    db.transaction(() => {
      db.prepare(
        'DELETE FROM drive_oauth_states WHERE user_id=? OR expires_at<=?',
      ).run(session.user.id, now())
      db.prepare(
        'INSERT INTO drive_oauth_states(digest,user_id,session_id,expires_at,secret) VALUES(?,?,?,?,?)',
      ).run(
        hash,
        session.user.id,
        session.id,
        now() + 600000,
        sealer.seal({ verifier, folder, epoch }, 'oauth:' + hash),
      )
      db.prepare(
        "INSERT INTO drive_connection(id,epoch,owner_id,status,folder_id) VALUES(1,?,?,'disconnected',?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,owner_id=excluded.owner_id,status='disconnected',tokens=NULL,last_error=NULL",
      ).run(epoch, session.user.id, folder.id)
    }).immediate()
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    })
    return {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?' + query,
    }
  }
  async function callback(
    session: ActiveSession,
    input: { state: string; code?: string; error?: string },
  ) {
    requireAdmin(session)
    const config = application(),
      hash = stateDigest(input.state)
    const pending = db
      .prepare(
        'SELECT * FROM drive_oauth_states WHERE digest=? AND user_id=? AND session_id=? AND expires_at>?',
      )
      .get(hash, session.user.id, session.id, now()) as
      { secret: string } | undefined
    if (!pending) throw new DriveError('DRIVE_AUTHORIZATION_EXPIRED')
    if (
      db.prepare('DELETE FROM drive_oauth_states WHERE digest=?').run(hash)
        .changes !== 1
    )
      throw new DriveError('DRIVE_AUTHORIZATION_EXPIRED')
    const secret = sealer.open<{
      verifier: string
      folder: { id: string; resourceKey: string | null }
      epoch: string
    }>(pending.secret, 'oauth:' + hash)
    let issuedRefresh: string | undefined
    try {
      if (input.error || !input.code)
        throw new DriveError('DRIVE_AUTHORIZATION_CANCELLED')
      const data = await tokenRequest(
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
          code: input.code,
          code_verifier: secret.verifier,
        }),
      )
      if (
        typeof data.scope !== 'string' ||
        !data.scope.split(' ').includes(scope)
      )
        throw new DriveError('DRIVE_PERMISSION_REQUIRED')
      const tokens = parseTokens(data),
        epoch = randomUUID()
      issuedRefresh = tokens.refresh
      const provider = new GoogleDriveAdapter({
        folderId: secret.folder.id,
        resourceKey: secret.folder.resourceKey,
        appId,
        fetch: options.fetch,
        sleep: options.sleep,
        token: async () => tokens.access,
      })
      const folder = await provider.validateFolder(),
        email = await provider.account()
      // A disconnect or replacement attempt during the Google round trip cannot resurrect access.
      if (
        connection()?.epoch !== secret.epoch ||
        !db
          .prepare('SELECT 1 FROM sessions WHERE id=? AND user_id=?')
          .get(session.id, session.user.id)
      )
        throw new DriveError('DRIVE_AUTHORIZATION_EXPIRED')
      controller.abort()
      controller = new AbortController()
      db.prepare(
        "INSERT INTO drive_connection(id,epoch,owner_id,status,folder_id,folder_name,resource_key,account_email,tokens) VALUES(1,?,?,'connected',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,owner_id=excluded.owner_id,status='connected',folder_id=excluded.folder_id,folder_name=excluded.folder_name,resource_key=excluded.resource_key,account_email=excluded.account_email,tokens=excluded.tokens,last_error=NULL,retry_at=NULL,last_sync=NULL,lease_owner=NULL,lease_until=NULL",
      ).run(
        epoch,
        session.user.id,
        folder.id,
        folder.name,
        secret.folder.resourceKey,
        email,
        sealer.seal(tokens, 'tokens:' + epoch),
      )
      schedule()
    } catch (error) {
      if (issuedRefresh) {
        try {
          await run('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: issuedRefresh }),
            signal: AbortSignal.timeout(8000),
          })
        } catch {
          /* The unpersisted credential is discarded even when Google is unavailable. */
        }
      }
      if (connection()?.epoch === secret.epoch) recordError(error)
      throw error
    }
  }
  async function put(
    provider: EncryptedFileStore,
    row: Connection,
    kind: 'snapshot' | 'commit',
    value: unknown,
  ) {
    const hash = digest(value)
    let saved = db
      .prepare(
        'SELECT file_id FROM drive_objects WHERE folder_id=? AND kind=? AND digest=?',
      )
      .get(row.folder_id, kind, hash) as { file_id: string } | undefined
    if (!saved) {
      const id = await provider.allocate()
      check(row.epoch)
      db.prepare(
        'INSERT INTO drive_objects(folder_id,kind,digest,file_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
      ).run(row.folder_id, kind, hash, id)
      saved = db
        .prepare(
          'SELECT file_id FROM drive_objects WHERE folder_id=? AND kind=? AND digest=?',
        )
        .get(row.folder_id, kind, hash) as { file_id: string }
    }
    check(row.epoch)
    try {
      await provider.create(
        saved.file_id,
        kind,
        hash,
        sealer.seal(value, context(row.folder_id, kind)),
      )
    } catch (error) {
      if (safeError(error) !== 'DRIVE_OBJECT_EXISTS') throw error
      const existing = await provider.read(saved.file_id, kind)
      if (
        digest(sealer.open(existing.sealed, context(row.folder_id, kind))) !==
        hash
      )
        throw new DriveError('DRIVE_OBJECT_ID_COLLISION')
    }
    return { id: saved.file_id, hash }
  }
  async function heads(
    provider: EncryptedFileStore,
    row: Connection,
  ): Promise<Head[]> {
    const files = await provider.list('commit'),
      commits = new Map<string, Commit>()
    for (const file of files) {
      check(row.epoch)
      let commit: Commit
      const cached = db
        .prepare(
          'SELECT version,sealed FROM drive_commit_cache WHERE file_id=?',
        )
        .get(file.id) as { version: string; sealed: string } | undefined
      if (cached && cached.version === file.version)
        commit = sealer.open<Commit>(
          cached.sealed,
          context(row.folder_id, 'commit'),
        )
      else {
        const downloaded = await provider.read(file.id, 'commit')
        commit = sealer.open<Commit>(
          downloaded.sealed,
          context(row.folder_id, 'commit'),
        )
        db.prepare(
          'INSERT INTO drive_commit_cache(file_id,version,sealed) VALUES(?,?,?) ON CONFLICT(file_id) DO UPDATE SET version=excluded.version,sealed=excluded.sealed',
        ).run(file.id, file.version, downloaded.sealed)
      }
      const hash = digest(commit)
      if (
        commit.v !== 1 ||
        commit.appId !== appId ||
        file.appProperties?.hash !== hash ||
        !Array.isArray(commit.parents) ||
        commit.parents.length > 16 ||
        commit.parents.some(
          (parent) =>
            typeof parent !== 'string' || !/^[a-f0-9]{64}$/.test(parent),
        ) ||
        !Array.isArray(commit.snapshots) ||
        commit.snapshots.length > 3 ||
        !Number.isSafeInteger(commit.createdAt) ||
        !commit.mutationId
      )
        throw new DriveError('DRIVE_COMMIT_INVALID')
      commits.set(hash, commit)
    }
    const parents = new Set<string>()
    for (const commit of commits.values())
      for (const parent of commit.parents) {
        if (!commits.has(parent)) throw new DriveError('DRIVE_HISTORY_MISSING')
        parents.add(parent)
      }
    const result = [...commits]
      .filter(([hash]) => !parents.has(hash))
      .map(([hash, commit]) => ({ hash, commit }))
    if (commits.size && !result.length)
      throw new DriveError('DRIVE_HISTORY_INVALID')
    if (result.length > 16) throw new DriveError('DRIVE_TOO_MANY_CONFLICTS')
    return result.sort((a, b) => a.hash.localeCompare(b.hash))
  }
  async function download(
    provider: EncryptedFileStore,
    row: Connection,
    head: Head,
  ): Promise<SnapshotSet> {
    const result: SnapshotSet = {},
      users = new Set(
        (db.prepare('SELECT id FROM users').all() as { id: string }[]).map(
          (value) => value.id,
        ),
      )
    for (const ref of head.commit.snapshots) {
      if (
        typeof ref.namespace !== 'string' ||
        (!ref.namespace.startsWith('personal:') &&
          !ref.namespace.startsWith('household:')) ||
        result[ref.namespace] ||
        !/^[a-f0-9]{64}$/.test(ref.hash) ||
        typeof ref.id !== 'string'
      )
        throw new DriveError('DRIVE_COMMIT_INVALID')
      const file = await provider.read(ref.id, 'snapshot')
      const value = sealer.open<Snapshot>(
        file.sealed,
        context(row.folder_id, 'snapshot'),
      )
      if (digest(value) !== ref.hash)
        throw new DriveError('DRIVE_DATA_AUTHENTICATION_FAILED')
      validateSnapshot(ref.namespace, value, users)
      result[ref.namespace] = value
    }
    return result
  }
  async function perform(choice?: {
    id: string
    copy: string
  }): Promise<boolean> {
    application()
    const row = connection()
    if (!row || row.status !== 'connected')
      throw new DriveError('DRIVE_NOT_CONNECTED')
    const lease = randomUUID()
    if (
      db
        .prepare(
          'UPDATE drive_connection SET lease_owner=?,lease_until=? WHERE id=1 AND epoch=? AND (lease_until IS NULL OR lease_until<?)',
        )
        .run(lease, now() + 600000, row.epoch, now()).changes !== 1
    )
      throw new DriveError('DRIVE_SYNC_BUSY', true)
    try {
      const provider = adapter(row)
      await provider.validateFolder()
      check(row.epoch)
      let cloudHeads = await heads(provider, row)
      if (
        !choice &&
        db
          .prepare(
            'SELECT 1 FROM drive_conflicts WHERE folder_id=? AND resolved_at IS NULL',
          )
          .get(row.folder_id)
      ) {
        rememberConflict(row, cloudHeads)
        throw new DriveError('DRIVE_CONFLICT')
      }
      const local = exportSnapshots(db),
        localHash = digest(local),
        checkpoint = db
          .prepare(
            'SELECT heads,hashes FROM drive_checkpoints WHERE folder_id=?',
          )
          .get(row.folder_id) as { heads: string; hashes: string } | undefined
      let selected: SnapshotSet
      if (choice) {
        const conflict = db
          .prepare(
            'SELECT sealed FROM drive_conflicts WHERE id=? AND folder_id=? AND resolved_at IS NULL',
          )
          .get(choice.id, row.folder_id) as { sealed: string } | undefined
        if (!conflict) throw new DriveError('DRIVE_CONFLICT_CHANGED')
        const saved = sealer.open<Conflict>(
          conflict.sealed,
          'conflict:' + choice.id,
        )
        if (saved.required.some((id) => saved.approvals[id] !== choice.copy))
          throw new DriveError('DRIVE_CONFLICT_APPROVAL_REQUIRED')
        if (
          saved.localHash !== localHash ||
          canonical(saved.heads.map((head) => head.hash)) !==
            canonical(cloudHeads.map((head) => head.hash))
        ) {
          rememberConflict(row, cloudHeads)
          throw new DriveError('DRIVE_CONFLICT_CHANGED')
        }
        if (choice.copy === 'local') selected = local
        else {
          const head = cloudHeads.find((value) => value.hash === choice.copy)
          if (!head) throw new DriveError('DRIVE_CONFLICT_CHANGED')
          selected = { ...local, ...(await download(provider, row, head)) }
        }
      } else {
        if (cloudHeads.length > 1) {
          rememberConflict(row, cloudHeads)
          throw new DriveError('DRIVE_CONFLICT')
        }
        if (!cloudHeads.length && checkpoint)
          throw new DriveError('DRIVE_HISTORY_MISSING')
        const remote = cloudHeads.length
          ? await download(provider, row, cloudHeads[0])
          : {}
        const base = checkpoint
          ? (JSON.parse(checkpoint.hashes) as Record<string, string>)
          : {}
        const left = hashes(local),
          right = hashes(remote)
        selected = {}
        for (const namespace of new Set([
          ...Object.keys(local),
          ...Object.keys(remote),
        ])) {
          if (left[namespace] === right[namespace])
            selected[namespace] = local[namespace]
          else if (!remote[namespace] && !base[namespace])
            selected[namespace] = local[namespace]
          else if (!local[namespace] && !base[namespace])
            selected[namespace] = remote[namespace]
          else if (left[namespace] === base[namespace] && remote[namespace])
            selected[namespace] = remote[namespace]
          else if (right[namespace] === base[namespace] && local[namespace])
            selected[namespace] = local[namespace]
          else {
            rememberConflict(row, cloudHeads)
            throw new DriveError('DRIVE_CONFLICT')
          }
        }
      }
      const selectedHashes = hashes(selected),
        remoteHashes =
          cloudHeads.length === 1
            ? Object.fromEntries(
                cloudHeads[0].commit.snapshots.map((ref) => [
                  ref.namespace,
                  ref.hash,
                ]),
              )
            : null
      if (
        choice ||
        !remoteHashes ||
        canonical(selectedHashes) !== canonical(remoteHashes)
      ) {
        const refs: Reference[] = []
        for (const namespace of Object.keys(selected).sort()) {
          const value = await put(
            provider,
            row,
            'snapshot',
            selected[namespace],
          )
          refs.push({ namespace, ...value })
        }
        check(row.epoch)
        // Never mutate a prior object or head. Racing writers produce detectable, preserved branches.
        const commit: Commit = {
          v: 1,
          appId,
          parents: cloudHeads.map((head) => head.hash),
          snapshots: refs,
          createdAt: now(),
          mutationId: randomUUID(),
        }
        await put(provider, row, 'commit', commit)
        cloudHeads = await heads(provider, row)
        if (cloudHeads.length !== 1) {
          rememberConflict(row, cloudHeads)
          throw new DriveError('DRIVE_CONFLICT')
        }
        if (
          canonical(
            Object.fromEntries(
              cloudHeads[0].commit.snapshots.map((ref) => [
                ref.namespace,
                ref.hash,
              ]),
            ),
          ) !== canonical(selectedHashes)
        ) {
          rememberConflict(row, cloudHeads)
          throw new DriveError('DRIVE_CONFLICT_CHANGED')
        }
      }
      check(row.epoch)
      let signInAgain = false
      let changed = false
      db.transaction(() => {
        const current = check(row.epoch)
        if (
          current.lease_owner !== lease ||
          !current.lease_until ||
          current.lease_until <= now()
        )
          throw new DriveError('DRIVE_SYNC_BUSY', true)
        if (digest(exportSnapshots(db)) !== localHash) {
          changed = true
          return
        }
        signInAgain = importSnapshots(db, selected)
        db.prepare(
          'INSERT INTO drive_checkpoints(folder_id,heads,hashes) VALUES(?,?,?) ON CONFLICT(folder_id) DO UPDATE SET heads=excluded.heads,hashes=excluded.hashes',
        ).run(
          row.folder_id,
          JSON.stringify(cloudHeads.map((head) => head.hash)),
          JSON.stringify(selectedHashes),
        )
        db.prepare(
          'UPDATE drive_conflicts SET resolved_at=? WHERE folder_id=? AND resolved_at IS NULL',
        ).run(now(), row.folder_id)
        db.prepare(
          'UPDATE drive_connection SET last_sync=?,last_error=NULL,retry_at=NULL WHERE id=1 AND epoch=?',
        ).run(now(), row.epoch)
      }).immediate()
      if (changed) {
        rememberConflict(row, cloudHeads)
        throw new DriveError('DRIVE_CONFLICT_CHANGED')
      }
      return signInAgain
    } catch (error) {
      if (connection()?.epoch === row.epoch) recordError(error)
      throw error
    } finally {
      db.prepare(
        'UPDATE drive_connection SET lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?',
      ).run(lease)
    }
  }
  async function sync(choice?: { id: string; copy: string }) {
    if (syncing) {
      if (choice) throw new DriveError('DRIVE_SYNC_BUSY', true)
      return syncing
    }
    syncing = perform(choice)
    try {
      return await syncing
    } finally {
      syncing = null
    }
  }
  async function resolve(session: ActiveSession, id: string, copy: string) {
    const row = connection()
    if (!row || row.status !== 'connected')
      throw new DriveError('DRIVE_NOT_CONNECTED')
    let ready = false
    db.transaction(() => {
      const current = check(row.epoch)
      if (current.lease_until && current.lease_until > now())
        throw new DriveError('DRIVE_SYNC_BUSY', true)
      const record = db
        .prepare(
          'SELECT sealed FROM drive_conflicts WHERE id=? AND folder_id=? AND resolved_at IS NULL',
        )
        .get(id, row.folder_id) as { sealed: string } | undefined
      if (!record) throw new DriveError('DRIVE_CONFLICT_CHANGED')
      const conflict = sealer.open<Conflict>(record.sealed, 'conflict:' + id)
      if (!conflict.required.includes(session.user.id))
        throw new DriveError('DRIVE_ACCESS_DENIED')
      if (
        copy !== 'local' &&
        !conflict.heads.some((head) => head.hash === copy)
      )
        throw new DriveError('DRIVE_CONFLICT_CHANGED')
      conflict.approvals[session.user.id] = copy
      db.prepare('UPDATE drive_conflicts SET sealed=? WHERE id=?').run(
        sealer.seal(conflict, 'conflict:' + id),
        id,
      )
      ready = conflict.required.every(
        (user) => conflict.approvals[user] === copy,
      )
    }).immediate()
    if (ready) return sync({ id, copy })
    return false
  }
  function schedule() {
    if (closed || !started || !options.application) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      const row = connection()
      if (
        row?.status === 'connected' &&
        (!row.retry_at || row.retry_at <= now())
      )
        void sync().catch(() => {})
    }, 1500)
    timer.unref()
  }
  function start() {
    if (interval || !options.application) return
    started = true
    interval = setInterval(() => {
      const row = connection()
      if (
        row?.status === 'connected' &&
        (!row.retry_at || row.retry_at <= now())
      )
        void sync().catch(() => {})
    }, options.pollInterval ?? 60000)
    interval.unref()
    schedule()
  }
  async function disconnect(session: ActiveSession) {
    requireAdmin(session)
    const row = connection(),
      epoch = randomUUID()
    let token: string | undefined,
      unconfirmed = false
    try {
      if (row?.tokens)
        token = sealer.open<Tokens>(row.tokens, 'tokens:' + row.epoch).refresh
    } catch {
      unconfirmed = true
    }
    controller.abort()
    controller = new AbortController()
    clearTimeout(timer)
    db.transaction(() => {
      db.prepare('DELETE FROM drive_oauth_states').run()
      db.prepare(
        "UPDATE drive_connection SET epoch=?,status='disconnected',tokens=NULL,lease_owner=NULL,lease_until=NULL,last_error=NULL,retry_at=NULL WHERE id=1",
      ).run(epoch)
    }).immediate()
    if (token) {
      try {
        const response = await run('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(8000),
        })
        unconfirmed = !response.ok
        await response.body?.cancel()
      } catch {
        unconfirmed = true
      }
    }
    if (unconfirmed)
      db.prepare(
        "UPDATE drive_connection SET last_error='DRIVE_REMOTE_REVOCATION_UNCONFIRMED' WHERE id=1 AND epoch=?",
      ).run(epoch)
  }
  async function close() {
    closed = true
    clearTimeout(timer)
    clearInterval(interval)
    controller.abort()
    if (syncing) await syncing.catch(() => {})
  }
  return {
    async backupStore(folder: { id: string; resourceKey: string | null }) {
      const row = connection()
      if (!row || !options.application)
        throw new DriveError('DRIVE_APPLICATION_NOT_CONFIGURED')
      check(row.epoch)
      if (folder.id === row.folder_id)
        throw new DriveError('DRIVE_BACKUP_FOLDER_MUST_DIFFER')
      const store = adapter({
        ...row,
        folder_id: folder.id,
        resource_key: folder.resourceKey,
      })
      await store.validateFolder()
      check(row.epoch)
      return store
    },
    status,
    begin,
    callback,
    disconnect,
    sync,
    resolve,
    schedule,
    start,
    close,
    recordError,
  }
}
export type DriveService = ReturnType<typeof createDriveService>
