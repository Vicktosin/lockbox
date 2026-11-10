import { randomUUID } from 'node:crypto'
import { check, ProofError } from './errors.mjs'
import {
  clone,
  newIdentity,
  publicIdentity,
  signed,
  verify,
  wrap,
  unwrap,
  hash,
  validPublic,
} from './identity.mjs'
import { envelope, profile, contents } from './contracts.mjs'
export class Replica {
  constructor(store, role, getDrive) {
    check(['owner', 'partner'].includes(role))
    this.store = store
    this.getDrive = getDrive
    this.data = store.load() ?? {
      v: 1,
      role,
      identity: newIdentity(),
      google: null,
      state: { profile: null, personal: null, household: null, candidates: [] },
      folders: null,
      control: null,
      journal: { personal: [], household: [] },
      uploads: {},
      conflicts: { personal: [], household: [] },
      lastSync: null,
    }
    check(
      this.data.v === 1 && this.data.role === role,
      'PROOF_PROFILE_MISMATCH',
    )
    this.busy = false
    this.save()
  }
  save() {
    this.store.save(this.data)
  }
  get id() {
    return this.data.identity.accountId
  }
  status() {
    return {
      role: this.data.role,
      accountId: this.id,
      publicIdentity: publicIdentity(this.data.identity),
      fingerprint: hash(publicIdentity(this.data.identity)),
      google: this.data.google
        ? {
            emailAddress: this.data.google.emailAddress,
            permissionId: this.data.google.permissionId,
          }
        : null,
      configuredFolders: Boolean(this.data.folders),
      householdApproved: Boolean(this.data.control),
      lastSync: this.data.lastSync,
      conflicts: clone(this.data.conflicts),
      busy: this.busy,
    }
  }
  account(person) {
    if (this.data.google)
      check(
        this.data.google.permissionId === person.permissionId,
        'PROOF_GOOGLE_ACCOUNT_CHANGED',
      )
    this.data.google = person
    this.save()
  }
  state() {
    return clone(this.data.state)
  }
  heads(scope, journal = this.data.journal[scope]) {
    const parent = new Set(journal.flatMap((p) => p.body.parents))
    return journal
      .filter((p) => !parent.has(hash(p)))
      .map((p) => hash(p))
      .sort()
  }
  append(scope) {
    if (scope === 'household' && !this.data.control) return
    const vault = clone(
      scope === 'personal'
        ? this.data.state.personal
        : this.data.state.household,
    )
    delete vault.joined
    const snapshot =
      scope === 'personal'
        ? { profile: clone(this.data.state.profile), vault }
        : { vault }
    const body = {
      v: 1,
      kind: 'lockbox-proof-commit',
      scope,
      vaultId: vault.id,
      author: publicIdentity(this.data.identity),
      parents: this.heads(scope),
      nonce: randomUUID(),
      control: scope === 'household' ? hash(this.data.control) : null,
      snapshot,
    }
    this.data.journal[scope].push(signed(this.data.identity, body))
    check(this.data.journal[scope].length <= 256, 'PROOF_HISTORY_LIMIT')
  }
  api(path, body) {
    if (path === 'state') {
      check(body === undefined)
      return this.state()
    }
    check(!this.busy, 'PROOF_SYNC_BUSY')
    check(body && typeof body === 'object')
    const before = clone(this.data)
    try {
      const s = this.data.state
      const ownProfile = () => {
        check(
          s.profile && body.revision === s.profile.revision,
          'PROOF_REVISION_CONFLICT',
        )
        profile(body.profile)
        s.profile = {
          revision: s.profile.revision + 1,
          data: clone(body.profile),
        }
      }
      if (path === 'setup') {
        check(!s.profile && !s.personal, 'PROOF_ALREADY_INITIALIZED')
        profile(body.profile)
        envelope(body.payload)
        s.profile = { revision: 1, data: clone(body.profile) }
        s.personal = {
          id: 'personal:' + this.id,
          scope: 'personal',
          ownerId: this.id,
          revision: 1,
          payload: clone(body.payload),
          check: null,
        }
        this.append('personal')
      } else if (path === 'profile') {
        check(this.data.conflicts.personal.length === 0, 'PROOF_SYNC_CONFLICT')
        ownProfile()
        this.append('personal')
      } else if (path === 'personal') {
        check(
          s.personal &&
            body.revision === s.personal.revision &&
            this.data.conflicts.personal.length === 0,
          'PROOF_REVISION_CONFLICT',
        )
        envelope(body.payload)
        s.personal = {
          ...s.personal,
          revision: s.personal.revision + 1,
          payload: clone(body.payload),
        }
        this.append('personal')
      } else if (path === 'household/create') {
        check(
          this.data.role === 'owner' && !s.household && this.data.folders,
          'PROOF_OWNER_SETUP_REQUIRED',
        )
        check(/^[0-9a-f-]{36}$/.test(body.id))
        envelope(body.payload)
        envelope(body.check)
        ownProfile()
        s.household = {
          id: body.id,
          scope: 'shared',
          ownerId: this.id,
          revision: 1,
          payload: clone(body.payload),
          check: clone(body.check),
          joined: true,
        }
        this.append('personal')
      } else if (path === 'household/join') {
        check(
          this.data.control && s.household && !s.household.joined,
          'PROOF_INVITATION_REQUIRED',
        )
        ownProfile()
        s.household.joined = true
        this.append('personal')
      } else if (path === 'household/save') {
        check(
          s.household?.joined &&
            this.data.control &&
            body.revision === s.household.revision &&
            this.data.conflicts.household.length === 0,
          'PROOF_REVISION_CONFLICT',
        )
        envelope(body.payload)
        s.household = {
          ...s.household,
          revision: s.household.revision + 1,
          payload: clone(body.payload),
        }
        this.append('household')
      } else throw new ProofError('PROOF_OPERATION_OUTSIDE_LIMITED_SCOPE')
      this.save()
      return this.state()
    } catch (error) {
      this.data = before
      throw error
    }
  }
  pairing() {
    check(this.data.google, 'PROOF_GOOGLE_NOT_CONNECTED')
    return signed(this.data.identity, {
      v: 1,
      kind: 'lockbox-proof-pairing',
      identity: publicIdentity(this.data.identity),
      google: clone(this.data.google),
    })
  }
  async createFolders() {
    check(
      this.data.role === 'owner' &&
        this.data.google &&
        !this.data.folders &&
        this.data.state.profile,
      'PROOF_OWNER_SETUP_REQUIRED',
    )
    const drive = this.getDrive(),
      suffix = randomUUID(),
      root = await drive.folder('LOCKBOX-PROOF-ROOT-' + suffix),
      personal = await drive.folder('LOCKBOX-PROOF-OWNER-' + suffix, root.id),
      shared = await drive.folder('LOCKBOX-PROOF-HOUSEHOLD-' + suffix, root.id),
      partner = await drive.folder('LOCKBOX-PROOF-PARTNER-' + suffix, root.id)
    this.data.folders = {
      root: root.id,
      personal: personal.id,
      shared: shared.id,
      partnerPersonal: partner.id,
    }
    this.save()
    return this.status()
  }
  async grant(pairing, fingerprint, householdCode) {
    check(
      this.data.role === 'owner' &&
        this.data.state.household?.joined &&
        this.data.folders &&
        !this.data.control,
      'PROOF_OWNER_SETUP_REQUIRED',
    )
    validPublic(pairing?.body?.identity)
    const peer = verify(pairing, pairing.body.identity.signPublic)
    check(
      peer.kind === 'lockbox-proof-pairing' &&
        peer.v === 1 &&
        fingerprint === hash(peer.identity),
      'PROOF_COMPARE_FINGERPRINTS',
    )
    check(
      peer.google?.permissionId &&
        peer.google.emailAddress &&
        peer.google.permissionId !== this.data.google.permissionId &&
        peer.identity.accountId !== this.id,
      'PROOF_TWO_GOOGLE_ACCOUNTS_REQUIRED',
    )
    check(
      typeof householdCode === 'string' && householdCode.length < 300,
      'PROOF_HOUSEHOLD_KEY_INVALID',
    )
    const drive = this.getDrive()
    await drive.grant(this.data.folders.shared, peer.google)
    await drive.grant(this.data.folders.partnerPersonal, peer.google)
    const owner = publicIdentity(this.data.identity),
      control = signed(this.data.identity, {
        v: 1,
        kind: 'lockbox-proof-household',
        id: this.data.state.household.id,
        owner,
        members: [
          { identity: owner, google: this.data.google },
          { identity: peer.identity, google: peer.google },
        ],
      })
    this.data.control = control
    this.append('household')
    this.save()
    const packet = signed(this.data.identity, {
      v: 1,
      kind: 'lockbox-proof-grant',
      owner,
      recipient: peer.identity,
      recipientGoogle: peer.google,
      folders: {
        personal: this.data.folders.partnerPersonal,
        shared: this.data.folders.shared,
      },
      control,
      wrapped: wrap(householdCode, peer.identity.boxPublic),
    })
    this.data.grantPacket = packet
    this.save()
    await this.sync()
    return packet
  }
  importGrant(packet, fingerprint) {
    validPublic(packet?.body?.owner)
    const grant = verify(packet, packet.body.owner.signPublic)
    check(
      grant.v === 1 &&
        grant.kind === 'lockbox-proof-grant' &&
        fingerprint === hash(grant.owner),
      'PROOF_COMPARE_FINGERPRINTS',
    )
    check(
      this.data.role === 'partner' &&
        !this.data.control &&
        this.data.google &&
        grant.recipient.accountId === this.id &&
        grant.recipient.boxPublic === this.data.identity.boxPublic &&
        grant.recipientGoogle.permissionId === this.data.google.permissionId,
      'PROOF_GRANT_WRONG_RECIPIENT',
    )
    const control = verify(grant.control, grant.owner.signPublic)
    check(
      control.v === 1 &&
        control.kind === 'lockbox-proof-household' &&
        control.members.length === 2 &&
        control.owner.accountId === grant.owner.accountId &&
        control.members.some(
          (m) => hash(m.identity) === hash(publicIdentity(this.data.identity)),
        ),
      'PROOF_MEMBERSHIP_INVALID',
    )
    this.data.control = clone(grant.control)
    this.data.folders = clone(grant.folders)
    this.data.wrappedHousehold = grant.wrapped
    this.save()
    return this.status()
  }
  householdCode() {
    check(
      this.data.role === 'partner' &&
        this.data.control &&
        this.data.state.household &&
        !this.data.state.household.joined,
      'PROOF_INVITATION_REQUIRED',
    )
    return unwrap(this.data.wrappedHousehold, this.data.identity)
  }
  validateCommit(packet, scope) {
    const body = packet?.body
    check(
      body?.v === 1 &&
        body.kind === 'lockbox-proof-commit' &&
        body.scope === scope &&
        typeof body.nonce === 'string' &&
        Object.keys(body).sort().join(',') ===
          'author,control,kind,nonce,parents,scope,snapshot,v,vaultId',
      'PROOF_COMMIT_INVALID',
    )
    check(
      Array.isArray(body.parents) &&
        body.parents.length <= 32 &&
        body.parents.every((id) => /^[a-f0-9]{64}$/.test(id)),
      'PROOF_COMMIT_INVALID',
    )
    let owner, id, key
    if (scope === 'personal') {
      check(
        body.author.accountId === this.id &&
          hash(body.author) === hash(publicIdentity(this.data.identity)) &&
          body.control === null,
        'PROOF_PERSONAL_ACCESS_DENIED',
      )
      owner = this.id
      id = 'personal:' + this.id
      key = this.data.identity.signPublic
    } else {
      check(
        this.data.control && body.control === hash(this.data.control),
        'PROOF_MEMBERSHIP_INVALID',
      )
      const control = this.data.control.body,
        member = control.members.find(
          (m) => hash(m.identity) === hash(body.author),
        )
      check(member, 'PROOF_HOUSEHOLD_ACCESS_DENIED')
      owner = control.owner.accountId
      id = control.id
      key = member.identity.signPublic
    }
    verify(packet, key)
    contents(body.snapshot, scope, owner, id)
    return packet
  }
  async sync() {
    check(!this.busy, 'PROOF_SYNC_BUSY')
    check(this.data.folders && this.data.google, 'PROOF_GOOGLE_SETUP_REQUIRED')
    this.busy = true
    try {
      const drive = this.getDrive(),
        allowed = this.data.control?.body.members.map((m) => m.google) ?? [
          this.data.google,
        ]
      for (const scope of ['personal', 'household']) {
        if (scope === 'household' && !this.data.control) continue
        const folder =
          this.data.folders[scope === 'personal' ? 'personal' : 'shared']
        await drive.validateFolder(
          folder,
          scope === 'personal' && this.data.role === 'owner'
            ? [this.data.google]
            : allowed,
        )
        const journal = new Map(
            this.data.journal[scope].map((p) => [hash(p), p]),
          ),
          remote = new Set()
        const download = async () => {
          for (const file of await drive.list(folder)) {
            const packet = await drive.read(file.id, folder)
            this.validateCommit(packet, scope)
            remote.add(hash(packet))
            journal.set(hash(packet), packet)
            check(journal.size <= 256, 'PROOF_HISTORY_LIMIT')
          }
        }
        await download()
        for (const packet of this.data.journal[scope]) {
          if (packet.body.author.accountId !== this.id) continue
          const h = hash(packet)
          if (!this.data.uploads[h]) {
            this.data.uploads[h] = { id: await drive.allocate(), done: false }
            this.save()
          }
          const upload = this.data.uploads[h]
          if (upload.done) continue
          try {
            await drive.create(upload.id, folder, packet)
          } catch (error) {
            if (error.code !== 'PROOF_CLOUD_FILE_EXISTS') throw error
            check(
              hash(await drive.read(upload.id, folder)) === h,
              'PROOF_REMOTE_ID_COLLISION',
            )
          }
          check(
            hash(await drive.read(upload.id, folder)) === h,
            'PROOF_UPLOAD_READBACK_MISMATCH',
          )
          upload.done = true
          this.save()
        }
        await download()
        for (const h of journal.keys())
          check(remote.has(h), 'PROOF_CLOUD_HISTORY_MISSING')
        for (const packet of journal.values())
          for (const parent of packet.body.parents)
            check(journal.has(parent), 'PROOF_HISTORY_INCOMPLETE')
        const values = [...journal.values()],
          heads = this.heads(scope, values)
        check(heads.length > 0, 'PROOF_CLOUD_DATA_MISSING')
        this.data.journal[scope] = values
        this.data.conflicts[scope] = heads.length > 1 ? heads : []
        if (heads.length === 1) {
          const snapshot = journal.get(heads[0]).body.snapshot
          if (scope === 'personal') {
            this.data.state.profile = clone(snapshot.profile)
            this.data.state.personal = clone(snapshot.vault)
          } else
            this.data.state.household = {
              ...clone(snapshot.vault),
              joined: this.data.state.household?.joined ?? false,
            }
        }
        this.save()
      }
      this.data.lastSync = Date.now()
      this.save()
      return this.status()
    } finally {
      this.busy = false
    }
  }
}
