import type {
  VaultState,
  StoredProfile,
  StoredVault,
} from '../../../shared/client-vault.ts'
import type {
  Credential,
  CredentialDraft,
  Vault,
} from '../credentials/types.ts'
import { categories } from '../credentials/types.ts'
import {
  createProfile,
  destroyKeys,
  householdCode,
  open,
  parseHouseholdCode,
  randomKey,
  recoverProfile,
  rewrapMaster,
  rotateRecovery,
  seal,
  unlockProfile,
  validId,
  verifyRecovery,
  wrapKeyring,
  type UnlockedKeys,
  type VaultProfile,
} from './crypto.ts'
export type VaultApi = (path: string, body?: unknown) => Promise<VaultState>
export interface VaultFolder {
  id: string
  name: string
  vault: Vault
}
export interface VaultDocument {
  v: 1
  credentials: Credential[]
  folders: VaultFolder[]
}
const empty = (): VaultDocument => ({ v: 1, credentials: [], folders: [] })
function installHousehold(
  keys: UnlockedKeys,
  household: { id: string; key: Uint8Array },
) {
  const previous = keys.household
  keys.household = household
  previous?.key.fill(0)
}
const context = (vault: Pick<StoredVault, 'id' | 'revision'>) =>
  'vault:' + vault.id + ':' + vault.revision
function validateDocument(value: VaultDocument, scope: Vault): VaultDocument {
  if (
    value?.v !== 1 ||
    !Array.isArray(value.credentials) ||
    !Array.isArray(value.folders) ||
    value.credentials.length > 2000 ||
    value.folders.length > 128
  )
    throw new Error('Unsupported vault contents.')
  const folders = new Set<string>(),
    ids = new Set<string>()
  for (const folder of value.folders) {
    if (
      !validId(folder.id) ||
      folders.has(folder.id) ||
      folder.vault !== scope ||
      typeof folder.name !== 'string' ||
      !folder.name.trim() ||
      folder.name.length > 80
    )
      throw new Error('Invalid encrypted folder.')
    folders.add(folder.id)
  }
  for (const item of value.credentials) {
    const limits = {
      name: 100,
      url: 2000,
      username: 200,
      password: 256,
      notes: 4000,
    }
    if (
      !validId(item.id) ||
      ids.has(item.id) ||
      item.vault !== scope ||
      !categories.includes(item.category) ||
      !['emmanuel', 'partner'].includes(item.owner) ||
      typeof item.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      typeof item.color !== 'string' ||
      !/^[a-z]{1,20}$/.test(item.color)
    )
      throw new Error('Invalid encrypted credential.')
    for (const [field, max] of Object.entries(limits)) {
      const text = item[field as keyof typeof limits]
      if (typeof text !== 'string' || text.length > max)
        throw new Error('Credential field is too long.')
    }
    if (
      !item.name.trim() ||
      !item.password ||
      !item.username.trim() ||
      (item.folderId && !folders.has(item.folderId))
    )
      throw new Error('Invalid credential or folder.')
    if (!['https:', 'http:'].includes(new URL(item.url).protocol))
      throw new Error('Only HTTP and HTTPS websites are supported.')
    ids.add(item.id)
  }
  return value
}
export class VaultEngine {
  readonly userId: string
  private api: VaultApi
  private keys: UnlockedKeys | null
  private state: VaultState
  private documents: { personal: VaultDocument; shared: VaultDocument }
  private epoch = 0
  private writing = false
  private constructor(
    api: VaultApi,
    userId: string,
    state: VaultState,
    keys: UnlockedKeys,
  ) {
    this.api = async (path, body) => {
      try {
        return await api(path, body)
      } catch (error) {
        if ((error as { status?: number }).status === 401) this.lock()
        throw error
      }
    }
    this.userId = userId
    this.keys = keys
    this.state = state
    this.documents = { personal: empty(), shared: empty() }
    try {
      this.read(state)
    } catch (error) {
      this.lock()
      throw error
    }
  }
  private read(state: VaultState) {
    const keys = this.requireKeys()
    if (!state.personal || !state.profile)
      throw new Error('Vault profile is missing.')
    const personal = validateDocument(
      open<VaultDocument>(
        keys.personal,
        state.personal.payload,
        context(state.personal),
      ),
      'personal',
    )
    let shared = empty()
    if (state.household?.joined) {
      if (!keys.household || keys.household.id !== state.household.id)
        throw new Error('Household key is missing.')
      shared = validateDocument(
        open<VaultDocument>(
          keys.household.key,
          state.household.payload,
          context(state.household),
        ),
        'shared',
      )
    }
    this.documents = { personal, shared }
    this.state = state
  }
  private requireKeys() {
    if (!this.keys) throw new Error('Vault is locked.')
    return this.keys
  }
  get locked() {
    return this.keys === null
  }
  get credentials() {
    this.requireKeys()
    return [
      ...this.documents.personal.credentials,
      ...this.documents.shared.credentials,
    ]
  }
  get folders() {
    this.requireKeys()
    return [
      ...this.documents.personal.folders,
      ...this.documents.shared.folders,
    ]
  }
  get household() {
    return this.state.household
  }
  get candidates() {
    return this.state.candidates
  }
  get encryptedState() {
    return structuredClone(this.state)
  }
  lock() {
    this.epoch++
    if (this.keys) destroyKeys(this.keys)
    this.keys = null
    this.documents = { personal: empty(), shared: empty() }
  }
  static prepare = createProfile
  static async finishSetup(
    api: VaultApi,
    userId: string,
    draft: Awaited<ReturnType<typeof createProfile>>,
    confirmation: string,
  ) {
    verifyRecovery(userId, draft.profile, confirmation, draft.keys.root)
    const payload = seal(
      draft.keys.personal,
      empty(),
      context({ id: 'personal:' + userId, revision: 1 }),
    )
    const state = await api('setup', { profile: draft.profile, payload })
    return new VaultEngine(api, userId, state, draft.keys)
  }
  static async unlock(api: VaultApi, userId: string, password: string) {
    const state = await api('state')
    if (!state.profile) throw new Error('Create your vault first.')
    const keys = await unlockProfile(userId, state.profile.data, password)
    return new VaultEngine(api, userId, state, keys)
  }
  static async prepareRecovery(
    api: VaultApi,
    userId: string,
    code: string,
    password: string,
    confirmation: string,
  ) {
    const state = await api('state')
    if (!state.profile) throw new Error('Vault profile is missing.')
    const keys = recoverProfile(userId, state.profile.data, code)
    try {
      const master = await rewrapMaster(
        userId,
        state.profile.data,
        keys,
        password,
        confirmation,
      )
      const rotated = rotateRecovery(userId, master, keys)
      return { state, keys, ...rotated }
    } catch (error) {
      destroyKeys(keys)
      throw error
    }
  }
  static async finishRecovery(
    api: VaultApi,
    userId: string,
    draft: Awaited<ReturnType<typeof VaultEngine.prepareRecovery>>,
    confirmation: string,
  ) {
    verifyRecovery(userId, draft.profile, confirmation, draft.keys.root)
    const state = await api('profile', {
      revision: draft.state.profile!.revision,
      profile: draft.profile,
    })
    return new VaultEngine(api, userId, state, draft.keys)
  }
  private async mutation(operation: () => Promise<void>) {
    this.requireKeys()
    if (this.writing) throw new Error('Wait for the current save to finish.')
    this.writing = true
    try {
      await operation()
    } finally {
      this.writing = false
    }
  }
  private async commit(path: string, body: unknown) {
    const epoch = this.epoch
    const state = await this.api(path, body)
    if (epoch !== this.epoch || this.locked)
      throw new Error(
        'Vault was locked; unlock again to check the saved state.',
      )
    try {
      this.read(state)
    } catch (error) {
      this.lock()
      throw error
    }
  }
  async refresh() {
    const epoch = this.epoch
    this.requireKeys()
    const state = await this.api('state')
    if (epoch === this.epoch && !this.locked) {
      try {
        this.read(state)
      } catch (error) {
        this.lock()
        throw error
      }
    }
  }
  private encrypt(scope: Vault, document: VaultDocument) {
    validateDocument(document, scope)
    const keys = this.requireKeys(),
      record = scope === 'personal' ? this.state.personal : this.state.household
    if (
      !record ||
      (scope === 'shared' && (!this.state.household?.joined || !keys.household))
    )
      throw new Error('Join the Household vault first.')
    return seal(
      scope === 'personal' ? keys.personal : keys.household!.key,
      document,
      context({ ...record, revision: record.revision + 1 }),
    )
  }
  private async saveDocument(scope: Vault, document: VaultDocument) {
    const record =
      scope === 'personal' ? this.state.personal : this.state.household
    if (!record) throw new Error('Vault unavailable.')
    await this.commit(scope === 'personal' ? 'personal' : 'household/save', {
      revision: record.revision,
      payload: this.encrypt(scope, document),
    })
  }
  async saveCredential(draft: CredentialDraft, id?: string) {
    return this.mutation(async () => {
      const existing = id
        ? this.credentials.find((item) => item.id === id)
        : undefined
      if (id && !existing) throw new Error('Credential not found.')
      const item: Credential = {
        ...draft,
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        color: existing?.color ?? 'purple',
      }
      const destination = structuredClone(this.documents[item.vault])
      destination.credentials = destination.credentials.filter(
        (value) => value.id !== item.id,
      )
      destination.credentials.push(item)
      if (existing && existing.vault !== item.vault) {
        const source = structuredClone(this.documents[existing.vault])
        source.credentials = source.credentials.filter(
          (value) => value.id !== id,
        )
        const personal = item.vault === 'personal' ? destination : source,
          shared = item.vault === 'shared' ? destination : source
        await this.commit('move', {
          personalRevision: this.state.personal!.revision,
          personal: this.encrypt('personal', personal),
          sharedRevision: this.state.household!.revision,
          shared: this.encrypt('shared', shared),
        })
      } else await this.saveDocument(item.vault, destination)
    })
  }
  async deleteCredential(id: string) {
    return this.mutation(async () => {
      const item = this.credentials.find((value) => value.id === id)
      if (!item) throw new Error('Credential not found.')
      await this.saveDocument(item.vault, {
        ...this.documents[item.vault],
        credentials: this.documents[item.vault].credentials.filter(
          (value) => value.id !== id,
        ),
      })
    })
  }
  async saveFolder(name: string, vault: Vault, id?: string) {
    return this.mutation(async () => {
      const document = structuredClone(this.documents[vault])
      const folder = { id: id ?? crypto.randomUUID(), name: name.trim(), vault }
      document.folders = document.folders.filter(
        (item) => item.id !== folder.id,
      )
      document.folders.push(folder)
      await this.saveDocument(vault, document)
    })
  }
  async deleteFolder(id: string, vault: Vault) {
    return this.mutation(async () => {
      const document = structuredClone(this.documents[vault])
      document.folders = document.folders.filter((item) => item.id !== id)
      document.credentials = document.credentials.map((item) =>
        item.folderId === id ? { ...item, folderId: undefined } : item,
      )
      await this.saveDocument(vault, document)
    })
  }
  async changeMaster(current: string, password: string, confirmation: string) {
    return this.mutation(async () => {
      const epoch = this.epoch,
        profile = this.state.profile!,
        proof = await unlockProfile(this.userId, profile.data, current)
      destroyKeys(proof)
      if (epoch !== this.epoch) throw new Error('Vault is locked.')
      const next = await rewrapMaster(
        this.userId,
        profile.data,
        this.requireKeys(),
        password,
        confirmation,
      )
      if (epoch !== this.epoch) throw new Error('Vault is locked.')
      await this.commit('profile', {
        revision: profile.revision,
        profile: next,
      })
    })
  }
  verifyRecovery(code: string) {
    verifyRecovery(
      this.userId,
      this.state.profile!.data,
      code,
      this.requireKeys().root,
    )
  }
  async replaceRecovery(current: string, confirmation: string) {
    let code = ''
    await this.mutation(async () => {
      const epoch = this.epoch,
        profile = this.state.profile!
      const proof = await unlockProfile(this.userId, profile.data, current)
      destroyKeys(proof)
      if (epoch !== this.epoch) throw new Error('Vault is locked.')
      if (confirmation !== 'REPLACE')
        throw new Error('Type REPLACE to invalidate the old recovery key.')
      const rotated = rotateRecovery(
        this.userId,
        profile.data,
        this.requireKeys(),
      )
      await this.commit('profile', {
        revision: profile.revision,
        profile: rotated.profile,
      })
      code = rotated.recoveryCode
    })
    return code
  }
  async restoreRevision(record: StoredVault) {
    return this.mutation(async () => {
      const keys = this.requireKeys(),
        scope = record.scope === 'shared' ? 'shared' : 'personal'
      const current =
        scope === 'personal' ? this.state.personal : this.state.household
      if (
        !current ||
        current.id !== record.id ||
        (scope === 'shared' && !this.state.household?.joined)
      )
        throw new Error('History is not accessible.')
      const key = scope === 'personal' ? keys.personal : keys.household?.key
      if (!key) throw new Error('Vault key unavailable.')
      const previous = validateDocument(
        open<VaultDocument>(key, record.payload, context(record)),
        scope,
      )
      // Recover missing entries only; never discard a newer live credential or folder.
      const next = structuredClone(this.documents[scope])
      for (const folder of previous.folders)
        if (!next.folders.some((x) => x.id === folder.id))
          next.folders.push(folder)
      for (const credential of previous.credentials)
        if (!next.credentials.some((x) => x.id === credential.id))
          next.credentials.push(credential)
      await this.saveDocument(scope, next)
    })
  }
  async createHousehold() {
    return this.mutation(async () => {
      const keys = this.requireKeys()
      if (keys.household) throw new Error('Household already exists.')
      const household = { id: crypto.randomUUID(), key: randomKey() },
        next = { ...keys, household }
      const profile = {
          ...this.state.profile!.data,
          keyring: wrapKeyring(next, this.userId),
        },
        revision = this.state.profile!.revision
      const epoch = this.epoch
      try {
        const state = await this.api('household/create', {
          id: household.id,
          revision,
          profile,
          payload: seal(
            household.key,
            empty(),
            context({ id: household.id, revision: 1 }),
          ),
          check: seal(
            household.key,
            { v: 1, id: household.id },
            'household-check:' + household.id,
          ),
        })
        if (epoch !== this.epoch) throw new Error('Vault is locked.')
        installHousehold(keys, household)
        this.read(state)
      } catch (error) {
        if (keys.household === household) this.lock()
        household.key.fill(0)
        throw error
      }
    })
  }
  exportHousehold() {
    const household = this.requireKeys().household
    if (!household) throw new Error('Household is not unlocked.')
    return householdCode(household.id, household.key)
  }
  async grantHousehold(userId: string) {
    return this.mutation(() => this.commit('household/grant', { userId }))
  }
  async revokeHousehold(userId: string) {
    return this.mutation(async () => {
      const keys = this.requireKeys(),
        record = this.state.household
      if (
        !record ||
        !keys.household ||
        record.ownerId !== this.userId ||
        userId === this.userId
      )
        throw new Error('Only the Household owner can remove another account.')
      const household = { id: record.id, key: randomKey() },
        epoch = this.epoch
      try {
        const profile = {
          ...this.state.profile!.data,
          keyring: wrapKeyring({ ...keys, household }, this.userId),
        }
        const state = await this.api('household/revoke', {
          userId,
          revision: record.revision,
          profileRevision: this.state.profile!.revision,
          profile,
          payload: seal(
            household.key,
            this.documents.shared,
            context({ ...record, revision: record.revision + 1 }),
          ),
          check: seal(
            household.key,
            { v: 1, id: record.id },
            'household-check:' + record.id,
          ),
        })
        if (epoch !== this.epoch) throw new Error('Vault is locked.')
        keys.household.key.fill(0)
        keys.household = household
        this.read(state)
      } catch (error) {
        if (keys.household === household) this.lock()
        household.key.fill(0)
        throw error
      }
    })
  }
  async joinHousehold(code: string) {
    return this.mutation(async () => {
      const household = parseHouseholdCode(code),
        keys = this.requireKeys(),
        record = this.state.household
      const epoch = this.epoch
      try {
        if (
          !record ||
          record.joined ||
          record.id !== household.id ||
          !record.check
        )
          throw new Error(
            'A household invitation for this account is required.',
          )
        const check = open<{ v: number; id: string }>(
          household.key,
          record.check,
          'household-check:' + household.id,
        )
        if (check.v !== 1 || check.id !== household.id)
          throw new Error('Incorrect household key.')
        const profile = {
          ...this.state.profile!.data,
          keyring: wrapKeyring({ ...keys, household }, this.userId),
        }
        const state = await this.api('household/join', {
          revision: this.state.profile!.revision,
          profile,
        })
        if (epoch !== this.epoch) throw new Error('Vault is locked.')
        installHousehold(keys, household)
        this.read(state)
      } catch (error) {
        if (keys.household === household) this.lock()
        household.key.fill(0)
        throw error
      }
    })
  }
}
export type SetupDraft = Awaited<ReturnType<typeof VaultEngine.prepare>>
export type RecoveryDraft = Awaited<
  ReturnType<typeof VaultEngine.prepareRecovery>
>
export type { StoredProfile, VaultProfile, VaultState }
