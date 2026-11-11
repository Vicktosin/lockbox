import { open, seal, fromBase64 } from '../../../src/features/vault/crypto.ts'
import { createPortableBackup, readPortableBackup } from './portable-backup.mjs'
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
  constructor(store, role, getDrive, { cloudTest = false } = {}) {
    check(['owner', 'partner'].includes(role))
    this.cloudTest = cloudTest
    this.store = store
    this.getDrive = getDrive
    this.data = store.load() ?? {
      v: 1,
      cloudTest,
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
    check(
      (this.data.cloudTest ?? false) === cloudTest,
      'PROOF_PROFILE_MODE_MISMATCH',
    )
    this.identity = null
    this.identityIdleMs = 5 * 60 * 1000
    this.busy = false
    this.save()
  }
  identityExpired() {
    return (
      this.identityDeadline !== undefined &&
      (performance.now() >= this.identityDeadline ||
        Date.now() >= this.identityExpiresAt)
    )
  }
  touchIdentity() {
    if (this.identityExpired()) {
      this.lockIdentity()
      return false
    }
    clearTimeout(this.identityTimer)
    if (!this.identity) return false
    this.identityDeadline = performance.now() + this.identityIdleMs
    this.identityExpiresAt = Date.now() + this.identityIdleMs
    this.identityTimer = setTimeout(
      () => this.lockIdentity(),
      this.identityIdleMs,
    )
    this.identityTimer.unref?.()
    return true
  }
  lockIdentity() {
    clearTimeout(this.identityTimer)
    // JavaScript cannot guarantee string zeroisation; drop all private references.
    this.identity = null
    this.identityDeadline = undefined
    this.identityExpiresAt = undefined
    this.onLocked?.()
  }
  requireIdentity() {
    if (this.identityExpired()) this.lockIdentity()
    check(this.identity, 'PROOF_VAULT_LOCKED')
    return this.identity
  }
  unlockIdentity(
    encodedRoot,
    candidate = this.data.state.profile?.data,
    persist = true,
  ) {
    this.lockIdentity()
    check(candidate, 'PROOF_PROFILE_REQUIRED')
    profile(candidate)
    const root = fromBase64(encodedRoot)
    check(root.length === 32, 'PROOF_KEY_INVALID')
    try {
      // Authenticate root possession using the existing Phase 3 keyring envelope.
      open(root, candidate.keyring, 'keyring:' + this.id)
      const context =
        'native-device-identity:' + this.id + ':' + this.data.identity.deviceId
      const identity = this.data.identityEnvelope
        ? open(root, this.data.identityEnvelope, context)
        : clone(this.data.identity)
      check(
        hash(publicIdentity(identity)) ===
          hash(publicIdentity(this.data.identity)),
        'PROOF_IDENTITY_MISMATCH',
      )
      // Validate signing-key possession before retaining an unlocked identity.
      verify(signed(identity, { challenge: this.id }), identity.signPublic)
      if (!this.data.identityEnvelope) {
        const previousIdentity = this.data.identity
        this.data.identityEnvelope = seal(root, identity, context)
        this.data.identity = publicIdentity(identity)
        try {
          if (persist) this.save()
        } catch (error) {
          this.data.identity = previousIdentity
          delete this.data.identityEnvelope
          throw error
        }
      }
      this.identity = identity
      this.touchIdentity()
    } finally {
      root.fill(0)
    }
    return true
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
      identityUnlocked: Boolean(this.identity),
      stateToken: hash(this.data.state),
      pendingChanges: [
        ...this.data.journal.personal,
        ...this.data.journal.household,
      ].filter(
        (p) =>
          p.body.author.accountId === this.id &&
          !this.data.uploads[hash(p)]?.done,
      ).length,
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
    this.data.journal[scope].push(signed(this.requireIdentity(), body))
    check(this.data.journal[scope].length <= 256, 'PROOF_HISTORY_LIMIT')
  }
  api(path, body, setupRoot) {
    if (path === 'state') {
      check(body === undefined)
      return this.state()
    }
    check(body && typeof body === 'object')
    const before = clone(this.data)
    try {
      if (path !== 'setup') this.requireIdentity()
      const s = this.data.state
      const ownProfile = () => {
        check(!this.data.conflicts.personal.length, 'PROOF_SYNC_CONFLICT')
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
        this.unlockIdentity(setupRoot, body.profile, false)
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
      } else if (path === 'move') {
        check(
          s.personal &&
            s.household?.joined &&
            (this.data.control || this.data.role === 'owner') &&
            body.personalRevision === s.personal.revision &&
            body.sharedRevision === s.household.revision &&
            !this.data.conflicts.personal.length &&
            !this.data.conflicts.household.length,
          'PROOF_REVISION_CONFLICT',
        )
        envelope(body.personal)
        envelope(body.shared)
        s.personal = {
          ...s.personal,
          revision: s.personal.revision + 1,
          payload: clone(body.personal),
        }
        s.household = {
          ...s.household,
          revision: s.household.revision + 1,
          payload: clone(body.shared),
        }
        this.append('personal')
        this.append('household')
      } else if (path === 'household/create') {
        check(
          this.data.role === 'owner' && !s.household,
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
            (this.data.control || this.data.role === 'owner') &&
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
      if (path === 'setup') this.lockIdentity()
      throw error
    }
  }
  pairing() {
    check(this.data.google, 'PROOF_GOOGLE_NOT_CONNECTED')
    return signed(this.requireIdentity(), {
      v: 1,
      kind: 'lockbox-proof-pairing',
      testOnly: this.cloudTest,
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
    this.requireIdentity()
    check(!this.busy && !this.granting, 'PROOF_SYNC_BUSY')
    this.granting = true
    try {
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
        (peer.testOnly ?? false) === this.cloudTest,
        'PROOF_PROFILE_MODE_MISMATCH',
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
      // Seal and sign before changing Drive permissions or durable membership.
      const wrapped = wrap(householdCode, peer.identity.boxPublic),
        owner = publicIdentity(this.data.identity)
      const control = signed(this.requireIdentity(), {
        v: 1,
        kind: 'lockbox-proof-household',
        testOnly: this.cloudTest,
        id: this.data.state.household.id,
        owner,
        members: [
          { identity: owner, google: this.data.google },
          { identity: peer.identity, google: peer.google },
        ],
      })
      const packet = signed(this.requireIdentity(), {
        v: 1,
        kind: 'lockbox-proof-grant',
        testOnly: this.cloudTest,
        owner,
        recipient: peer.identity,
        recipientGoogle: peer.google,
        folders: {
          personal: this.data.folders.partnerPersonal,
          shared: this.data.folders.shared,
        },
        control,
        wrapped,
      })
      const drive = this.getDrive(),
        allowed = [this.data.google, peer.google]
      await drive.validateFolder(this.data.folders.shared, allowed)
      await drive.validateFolder(this.data.folders.partnerPersonal, allowed)
      await drive.grant(this.data.folders.shared, peer.google)
      await drive.grant(this.data.folders.partnerPersonal, peer.google)
      this.requireIdentity()
      const before = clone(this.data)
      try {
        this.data.control = control
        this.append('household')
        this.data.grantPacket = packet
        this.save()
      } catch (error) {
        this.data = before
        throw error
      }
      // If sync fails the complete encrypted invitation is already recoverable.
      await this.sync()
      return packet
    } finally {
      this.granting = false
    }
  }
  importGrant(packet, fingerprint) {
    this.requireIdentity()
    check(this.data.state.profile, 'PROOF_PROFILE_REQUIRED')
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
    check(
      (grant.testOnly ?? false) === this.cloudTest,
      'PROOF_PROFILE_MODE_MISMATCH',
    )
    const control = verify(grant.control, grant.owner.signPublic)
    check(
      (control.testOnly ?? false) === this.cloudTest,
      'PROOF_PROFILE_MODE_MISMATCH',
    )
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
    return unwrap(this.data.wrappedHousehold, this.requireIdentity())
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
  historyVersions(scope) {
    this.requireIdentity()
    check(['personal', 'household'].includes(scope), 'PROOF_INPUT_INVALID')
    return [...this.data.journal[scope]].reverse().map((packet) => {
      this.validateCommit(packet, scope)
      return {
        id: hash(packet),
        author: clone(packet.body.author),
        snapshot: clone(packet.body.snapshot),
      }
    })
  }
  conflictVersions(scope) {
    this.requireIdentity()
    check(['personal', 'household'].includes(scope), 'PROOF_INPUT_INVALID')
    return this.data.conflicts[scope].map((id) => {
      const packet = this.data.journal[scope].find((p) => hash(p) === id)
      check(packet, 'PROOF_HISTORY_INCOMPLETE')
      this.validateCommit(packet, scope)
      return {
        id,
        author: clone(packet.body.author),
        snapshot: clone(packet.body.snapshot),
      }
    })
  }
  resolveConflict(scope, selected, expectedHeads) {
    this.requireIdentity()
    check(!this.busy, 'PROOF_SYNC_BUSY')
    const versions = this.conflictVersions(scope),
      heads = this.heads(scope)
    check(
      versions.length > 1 &&
        heads.length <= 32 &&
        Array.isArray(expectedHeads) &&
        hash([...expectedHeads].sort()) === hash(heads) &&
        hash([...this.data.conflicts[scope]].sort()) === hash(heads),
      'PROOF_CONFLICT_CHANGED',
    )
    const chosen = versions.find((v) => v.id === selected)
    check(chosen, 'PROOF_CONFLICT_CHANGED')
    check(
      scope === 'personal' || this.data.state.household?.joined,
      'PROOF_HOUSEHOLD_ACCESS_DENIED',
    )
    const before = clone(this.data)
    try {
      if (scope === 'personal') {
        // Preserve current master/recovery wrappers instead of rolling them back.
        this.data.state.profile.revision =
          Math.max(
            ...this.data.journal.personal.map(
              (p) => p.body.snapshot.profile.revision,
            ),
          ) + 1
        this.data.state.personal = clone(chosen.snapshot.vault)
      } else
        this.data.state.household = {
          ...clone(chosen.snapshot.vault),
          joined: true,
        }
      this.append(scope) // Parents include every retained head, including the unchosen branch.
      this.data.conflicts[scope] = []
      this.save()
      return this.state()
    } catch (error) {
      this.data = before
      throw error
    }
  }
  exportBackup(root) {
    this.requireIdentity()
    return createPortableBackup(this.data, root)
  }
  restoreBackup(packet, root, replacementProfile) {
    check(
      !this.busy &&
        !this.data.state.profile &&
        !this.data.state.personal &&
        !this.data.state.household &&
        !this.data.journal.personal.length &&
        !this.data.journal.household.length &&
        !this.data.control,
      'PROOF_RESTORE_REQUIRES_EMPTY_PROFILE',
    )
    const before = clone(this.data)
    try {
      const next = readPortableBackup(packet, root, this.data.role)
      check(
        (next.cloudTest ?? false) === this.cloudTest,
        'PROOF_PROFILE_MODE_MISMATCH',
      )
      check(
        next.state?.personal &&
          Array.isArray(next.journal?.personal) &&
          Array.isArray(next.journal?.household) &&
          next.journal.personal.length <= 256 &&
          next.journal.household.length <= 256,
        'PROOF_BACKUP_INVALID',
      )
      contents(
        { profile: next.state.profile, vault: next.state.personal },
        'personal',
        next.identity.accountId,
        'personal:' + next.identity.accountId,
      )
      if (next.control) {
        const control = verify(next.control, next.control.body.owner.signPublic)
        check(
          Boolean(control.testOnly) === this.cloudTest,
          'PROOF_PROFILE_MODE_MISMATCH',
        )
        check(
          control.kind === 'lockbox-proof-household' &&
            control.members?.length === 2 &&
            control.members.some(
              (m) => hash(m.identity) === hash(next.identity),
            ),
          'PROOF_MEMBERSHIP_INVALID',
        )
      }
      this.data = next
      this.unlockIdentity(root, next.state.profile.data, false)
      for (const scope of ['personal', 'household']) {
        const ids = new Set(
          next.journal[scope].map((p) => hash(this.validateCommit(p, scope))),
        )
        for (const p of next.journal[scope])
          for (const parent of p.body.parents)
            check(ids.has(parent), 'PROOF_HISTORY_INCOMPLETE')
      }
      if (replacementProfile) {
        check(
          !next.conflicts.personal.length,
          'PROOF_RECOVERY_CONFLICT_REVIEW_REQUIRED',
        )
        profile(replacementProfile)
        const key = fromBase64(root)
        try {
          open(key, replacementProfile.keyring, 'keyring:' + this.id)
        } finally {
          key.fill(0)
        }
        next.state.profile = {
          revision: next.state.profile.revision + 1,
          data: clone(replacementProfile),
        }
        this.append('personal')
      }
      // OAuth credentials are excluded by the portable format; reauthorise locally.
      this.save()
      return this.status()
    } catch (error) {
      this.data = before
      throw error
    } finally {
      this.lockIdentity()
    }
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
        const uploadSnapshot = [...this.data.journal[scope]]
        const journal = new Map(uploadSnapshot.map((p) => [hash(p), p])),
          remote = new Set()
        const download = async () => {
          for (const file of await drive.list(folder)) {
            const packet = await drive.read(file.id, folder)
            this.validateCommit(packet, scope)
            const id = hash(packet)
            remote.add(id)
            journal.set(id, packet)
            if (
              packet.body.author.accountId === this.id &&
              !this.data.uploads[id]?.done
            )
              this.data.uploads[id] = { id: file.id, done: true }
            check(journal.size <= 256, 'PROOF_HISTORY_LIMIT')
          }
        }
        await download()
        for (const packet of uploadSnapshot) {
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
        // Local edits stay available while Drive is slow/offline. Merge late local
        // commits, but never pretend that unuploaded commits are already in Drive.
        for (const packet of this.data.journal[scope])
          journal.set(hash(packet), packet)
        for (const [h, packet] of journal) {
          if (
            packet.body.author.accountId !== this.id ||
            this.data.uploads[h]?.done
          )
            check(remote.has(h), 'PROOF_CLOUD_HISTORY_MISSING')
        }
        check(journal.size <= 256, 'PROOF_HISTORY_LIMIT')
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
