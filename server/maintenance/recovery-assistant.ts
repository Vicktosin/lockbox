import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { rmSync } from 'node:fs'
import type { GoogleApplication } from '../drive/config.ts'
import {
  GoogleDriveAdapter,
  readJson,
  type Transport,
} from '../drive/provider.ts'
import { parseFolder } from '../drive/security.ts'
import { writePrivateNew } from '../security/key-file.ts'
import { requireEmptyDirectory } from '../security/private-files.ts'
import { retrieveAndRestore } from './retrieve.ts'
const hash = (s: string) => createHash('sha256').update(s).digest('base64url')
const equal = (a: unknown, b: string) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b))
export function createRecoveryAssistant(options: {
  origin: string
  target: string
  workspace: string
  application: GoogleApplication
  fetch?: Transport
}) {
  const url = new URL(options.origin)
  if (
    url.hostname !== '127.0.0.1' ||
    url.protocol !== 'http:' ||
    url.origin !== options.origin ||
    options.application.redirectUri !== options.origin + '/callback'
  )
    throw new Error('RECOVERY_LOOPBACK_CONFIGURATION_REQUIRED')
  const app = Fastify({
      logger: false,
      bodyLimit: 8192,
      trustProxy: false,
      ajv: {
        customOptions: {
          removeAdditional: false,
          coerceTypes: false,
          useDefaults: false,
        },
      },
    }),
    run = options.fetch ?? fetch
  const launch = randomBytes(32).toString('base64url'),
    session = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url'),
    deadline = Date.now() + 1800000
  let bootstrapped = false,
    pending:
      | {
          state: string
          verifier: string
          expires: number
          folder: ReturnType<typeof parseFolder>
          appId: string
        }
      | undefined,
    access: string | undefined,
    accessExpires = 0,
    installationId = '',
    store: GoogleDriveAdapter | undefined,
    refresh: string | undefined,
    busy = false,
    restored = false,
    revocationConfirmed = true
  const csrfBody = (properties: Record<string, unknown>) => ({
    body: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    },
  })
  const text = { type: 'string', minLength: 1, maxLength: 2000 }
  async function revoke() {
    if (refresh) {
      try {
        const r = await run('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refresh }),
        })
        if (!r.ok) revocationConfirmed = false
        await r.body?.cancel()
      } catch {
        revocationConfirmed = false
      }
      refresh = undefined
    }
    access = undefined
    store = undefined
  }
  app.register(cookie)
  function cleanAttempt(attempt: string) {
    if (!resolve(attempt).startsWith(resolve(options.workspace) + sep))
      throw new Error('RECOVERY_PATH_INVALID')
    rmSync(attempt, { recursive: true, force: true })
  }
  app.addHook('preHandler', async (r, p) => {
    if (r.headers.host !== url.host)
      return p.code(403).send({ error: 'RECOVERY_HOST_FORBIDDEN' })
    p.header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      )
    if (r.url.startsWith('/api/') && r.url !== '/api/bootstrap') {
      if (
        Date.now() > deadline ||
        !equal(r.cookies?.lockbox_recovery_session, session)
      )
        return p.code(401).send({ error: 'RECOVERY_SESSION_REQUIRED' })
      if (
        r.method === 'POST' &&
        (!equal(r.headers['x-recovery-csrf'], csrf) ||
          r.headers.origin !== options.origin ||
          !r.headers['content-type']?.startsWith('application/json'))
      )
        return p.code(403).send({ error: 'RECOVERY_REQUEST_FORBIDDEN' })
    }
  })
  app.post<{ Body: { launch: string } }>(
    '/api/bootstrap',
    {
      schema: csrfBody({
        launch: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
      }),
    },
    async (r, p) => {
      if (
        Date.now() > deadline ||
        bootstrapped ||
        r.headers.origin !== options.origin ||
        !equal(r.body.launch, launch)
      )
        return p.code(403).send({ error: 'RECOVERY_REQUEST_FORBIDDEN' })
      bootstrapped = true
      p.setCookie('lockbox_recovery_session', session, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1800,
      })
      return { csrf }
    },
  )
  app.get('/api/status', async () => ({ csrf, connected: !!store, restored }))
  app.post<{ Body: { folderLink: string; installationId: string } }>(
    '/api/connect',
    {
      schema: csrfBody({
        folderLink: text,
        installationId: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
      }),
    },
    async (r) => {
      if (busy || restored) throw new Error('RECOVERY_BUSY')
      await revoke()
      const verifier = randomBytes(32).toString('base64url'),
        state = randomBytes(32).toString('base64url')
      pending = {
        verifier,
        state,
        expires: Date.now() + 600000,
        folder: parseFolder(r.body.folderLink),
        appId: r.body.installationId,
      }
      const params = new URLSearchParams({
        client_id: options.application.clientId,
        redirect_uri: options.application.redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive',
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: hash(verifier),
        code_challenge_method: 'S256',
      })
      return {
        authorizationUrl:
          'https://accounts.google.com/o/oauth2/v2/auth?' + params,
      }
    },
  )
  app.get<{ Querystring: { state: string; code?: string; error?: string } }>(
    '/callback',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['state'],
          properties: {
            state: { type: 'string', maxLength: 200 },
            code: text,
            error: text,
          },
          additionalProperties: true,
        },
      },
    },
    async (r, p) => {
      const attempt = pending
      if (
        !attempt ||
        Date.now() > deadline ||
        !equal(r.cookies.lockbox_recovery_session, session) ||
        !equal(r.query.state, attempt.state) ||
        Date.now() > attempt.expires ||
        !r.query.code ||
        r.query.error
      )
        return p.code(400).send({ error: 'RECOVERY_AUTHORIZATION_FAILED' })
      pending = undefined
      const response = await run('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.application.clientId,
          client_secret: options.application.clientSecret,
          redirect_uri: options.application.redirectUri,
          grant_type: 'authorization_code',
          code: r.query.code,
          code_verifier: attempt.verifier,
        }),
      })
      const data = (await readJson(response, 32768)) as {
        access_token?: string
        refresh_token?: string
        scope?: string
        expires_in?: number
      }
      refresh =
        typeof data.refresh_token === 'string' ? data.refresh_token : undefined
      if (
        !response.ok ||
        typeof data.access_token !== 'string' ||
        data.access_token.length > 8192 ||
        /[\r\n]/.test(data.access_token) ||
        typeof data.expires_in !== 'number' ||
        data.expires_in < 1 ||
        data.expires_in > 86400 ||
        !data.scope
          ?.split(' ')
          .includes('https://www.googleapis.com/auth/drive')
      ) {
        await revoke()
        throw new Error('RECOVERY_AUTHORIZATION_FAILED')
      }
      access = data.access_token
      installationId = attempt.appId
      accessExpires = Date.now() + data.expires_in * 1000
      store = new GoogleDriveAdapter({
        folderId: attempt.folder.id,
        resourceKey: attempt.folder.resourceKey,
        appId: attempt.appId,
        fetch: run,
        token: async () => {
          if (!access || Date.now() >= accessExpires)
            throw new Error('RECOVERY_AUTHORIZATION_EXPIRED')
          return access
        },
      })
      try {
        await store.validateFolder()
      } catch (error) {
        await revoke()
        throw error
      }
      return p.redirect('/')
    },
  )
  app.get('/api/backups', async () => {
    if (!store) throw new Error('RECOVERY_CONNECT_REQUIRED')
    return {
      files: (await store.list('backup'))
        .map((x) => ({ id: x.id, name: x.name, hash: x.appProperties?.hash }))
        .sort((a, b) => (b.name ?? '').localeCompare(a.name ?? '')),
    }
  })
  app.post<{ Body: { fileId: string; emergencyKey: string } }>(
    '/api/restore',
    {
      schema: csrfBody({
        fileId: { type: 'string', pattern: '^[A-Za-z0-9_-]{5,200}$' },
        emergencyKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
      }),
    },
    async (r) => {
      if (!store || busy || restored) throw new Error('RECOVERY_NOT_READY')
      busy = true
      let sourceCreatedAt: number
      try {
        const attempt = join(options.workspace, 'attempt-' + randomUUID())
        requireEmptyDirectory(attempt)
        try {
          const key = join(attempt, 'emergency.key')
          writePrivateNew(key, r.body.emergencyKey + '\n')
          const result = await retrieveAndRestore(
            store,
            r.body.fileId,
            key,
            options.target,
            join(attempt, 'download'),
            installationId,
          )
          sourceCreatedAt = result.sourceCreatedAt
        } finally {
          cleanAttempt(attempt)
        }
        restored = true
        await revoke()
        return {
          restored: true,
          sourceCreatedAt,
          revocationConfirmed,
          next:
            'Restored backup created ' +
            new Date(sourceCreatedAt).toISOString() +
            '. ' +
            (Date.now() - sourceCreatedAt > 48 * 3600000
              ? 'This backup is older than 48 hours; newer data may be missing. '
              : '') +
            'Both users recover login with saved login codes, unlock with master/vault recovery keys, then reconnect Drive and verify a new backup.' +
            (revocationConfirmed
              ? ''
              : ' Google revocation was not confirmed; your maintainer must review Google permissions.'),
        }
      } finally {
        busy = false
      }
    },
  )
  app.get('/', async (_r, p) =>
    p
      .type('text/html')
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lockbox recovery assistant</title><h1>Restore Lockbox</h1><p>This private assistant restores into an empty installation. It never asks for master passwords. Keep the emergency backup record outside Google Drive.</p><p id="status" role="status"></p><form id="connect"><label>Backup folder link <input id="folder" required type="url"></label><label>Installation ID from emergency record <input id="installation" required></label><button>Connect to Google</button></form><button id="list">List encrypted backups</button><form id="restore"><label>Backup <select id="files" required></select></label><label>Emergency backup key <input id="key" type="password" autocomplete="off" required></label><label><input id="confirm" type="checkbox" required>I understand both accounts need their saved login recovery codes and their own master password or vault recovery key.</label><button>Verify and restore into clean installation</button></form><p>No login code: no automatic account reset. No master password and no vault recovery key: Personal decryption is unrecoverable. No emergency backup key: complete cloud backups cannot be restored.</p><script src="/assistant.js"></script></html>',
      ),
  )
  app.get('/assistant.js', async (_r, p) =>
    p
      .type('text/javascript')
      .send(
        `let csrf;const status=document.getElementById('status');async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-Recovery-CSRF':csrf||''}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Recovery failed');return data}async function action(fn){try{await fn()}catch(e){status.textContent=e.message}}action(async()=>{const launch=location.hash.slice(1);history.replaceState(null,'','/');if(launch)csrf=(await api('bootstrap',{launch})).csrf;else csrf=(await api('status')).csrf;status.textContent='Ready. Connect your backup Google account.'});document.getElementById('connect').onsubmit=e=>{e.preventDefault();action(async()=>{location.assign((await api('connect',{folderLink:document.getElementById('folder').value,installationId:document.getElementById('installation').value})).authorizationUrl)})};document.getElementById('list').onclick=()=>action(async()=>{const select=document.getElementById('files');select.replaceChildren();for(const f of(await api('backups')).files){const o=document.createElement('option');o.value=f.id;o.textContent=f.name||f.id;select.append(o)}status.textContent='Choose the backup to verify and restore.'});document.getElementById('restore').onsubmit=e=>{e.preventDefault();action(async()=>{const key=document.getElementById('key');const code=key.value;key.value='';status.textContent='Verifying cloud download and restoring. Please wait.';const result=await api('restore',{fileId:document.getElementById('files').value,emergencyKey:code});status.textContent=result.next})};`,
      ),
  )
  app.setErrorHandler((_e, _r, p) =>
    p
      .code(400)
      .send({ error: 'RECOVERY_FAILED_CHECK_BACKUP_KEY_AND_GOOGLE_ACCESS' }),
  )
  app.addHook('onClose', async () => revoke())
  return { app, launchUrl: options.origin + '/#' + launch }
}
