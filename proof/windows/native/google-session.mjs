import {
  GoogleConnection,
  nativeAuthorization,
  validateConfiguration,
} from './oauth.mjs'
import { NativeDrive } from './drive.mjs'
import { check, ProofError } from './errors.mjs'

/** OS-protected persistence is supplied by the app; tokens never enter the renderer. */
export class GoogleSession {
  constructor(
    configuration,
    {
      read,
      write,
      authorise = nativeAuthorization,
      account = (connection) => new NativeDrive(connection).account(),
      refreshFetch = fetch,
    },
  ) {
    this.configuration = validateConfiguration(configuration)
    this.read = read
    this.write = write
    this.authorise = authorise
    this.account = account
    this.refreshFetch = refreshFetch
    this.verifiedAt = null
    this.epoch = 0
    this.connection = null
    this.authorising = false
    this.lastError = ''
  }
  get connected() {
    return Boolean(this.connection)
  }
  restore() {
    const record = this.read()
    if (record.tokens) this.bind(record.tokens, this.epoch)
  }
  bind(tokens, epoch) {
    const client = new GoogleConnection(
      this.configuration,
      tokens,
      (next) => {
        check(
          this.epoch === epoch && this.connection === connection,
          'PROOF_GOOGLE_CONNECTION_CHANGED',
        )
        this.write({ ...this.read(), tokens: next })
      },
      this.refreshFetch,
    )
    const connection = {
      access: async (force) => {
        check(
          this.epoch === epoch && this.connection === connection,
          'PROOF_GOOGLE_CONNECTION_CHANGED',
        )
        try {
          return await client.access(force)
        } catch (error) {
          if (
            this.epoch === epoch &&
            [
              'PROOF_GOOGLE_RECONNECT_REQUIRED',
              'PROOF_GOOGLE_SCOPE_MISMATCH',
            ].includes(error.code)
          ) {
            this.lastError = error.code
            this.connection = null
          }
          throw error
        }
      },
    }
    this.connection = connection
  }
  async connect(options = {}, ensureUnlocked = () => {}) {
    check(!this.authorising, 'PROOF_GOOGLE_AUTH_IN_PROGRESS')
    this.authorising = true
    const epoch = this.epoch,
      controller = new AbortController()
    this.controller = controller
    try {
      const tokens = await this.authorise(this.configuration, {
        ...options,
        signal: controller.signal,
      })
      check(this.epoch === epoch, 'PROOF_GOOGLE_CONNECTION_CHANGED')
      ensureUnlocked()
      const fresh = new GoogleConnection(this.configuration, tokens, () => {})
      const google = await this.account(fresh)
      check(this.epoch === epoch, 'PROOF_GOOGLE_CONNECTION_CHANGED')
      ensureUnlocked()
      const previous = this.read()
      check(
        !previous.google ||
          previous.google.permissionId === google.permissionId,
        'PROOF_GOOGLE_ACCOUNT_CHANGED',
      )
      tokens.refresh ??=
        previous.tokens?.clientId === this.configuration.clientId &&
        previous.tokens.scope === this.configuration.scope
          ? previous.tokens.refresh
          : null
      check(
        typeof tokens.refresh === 'string' && tokens.refresh.length > 0,
        'PROOF_GOOGLE_REFRESH_GRANT_REQUIRED',
      )
      // A failed protected-file write must leave both the old grant and connection intact.
      this.write({ google, tokens })
      this.epoch++
      this.bind(tokens, this.epoch)
      this.lastError = ''
      this.verifiedAt = Date.now()
      return google
    } finally {
      this.authorising = false
      if (this.controller === controller) this.controller = null
    }
  }
  disconnect() {
    this.write({ ...this.read(), tokens: null })
    this.reset()
  }
  reset() {
    this.epoch++
    this.connection = null
    this.verifiedAt = null
    this.controller?.abort(new ProofError('PROOF_GOOGLE_AUTH_CANCELLED'))
    this.lastError = ''
  }
}
