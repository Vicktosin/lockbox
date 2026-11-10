/** Simulated Google REST service. No real credentials or network access. */
export class FictionalGoogle {
  constructor() {
    this.users = {
      owner: {
        permissionId: 'permission-owner',
        emailAddress: 'owner@example.invalid',
      },
      partner: {
        permissionId: 'permission-partner',
        emailAddress: 'partner@example.invalid',
      },
    }
    this.files = new Map()
    this.selected = { owner: new Set(), partner: new Set() }
    this.offline = new Set()
    this.requests = []
    this.counter = 0
    this.failAfterCreate = false
  }
  authorize(person, folders) {
    for (const id of folders) this.selected[person].add(id)
  }
  allowed(file, person, scope = true) {
    if (!file) return false
    if (file.owner === person) return true
    const parent = file.parents?.[0] ? this.files.get(file.parents[0]) : null
    const permission =
      file.shared?.has(person) ||
      (parent && this.allowed(parent, person, false))
    return Boolean(
      permission &&
      (!scope ||
        this.selected[person].has(file.id) ||
        (parent && this.selected[person].has(parent.id))),
    )
  }
  permissions(file) {
    const people = new Set([file.owner, ...file.shared])
    let parent = this.files.get(file.parents?.[0])
    while (parent) {
      people.add(parent.owner)
      for (const p of parent.shared) people.add(p)
      parent = this.files.get(parent.parents?.[0])
    }
    return [...people].map((p) => ({
      id: this.users[p].permissionId,
      type: 'user',
      role: p === file.owner ? 'owner' : 'writer',
      emailAddress: this.users[p].emailAddress,
    }))
  }
  async fetch(input, options = {}) {
    const url = new URL(input),
      method = options.method ?? 'GET',
      token = options.headers?.Authorization ?? '',
      person = token.replace('Bearer fictional-', ''),
      reply = (status, body) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
    this.requests.push({ url: input, method, body: options.body, person })
    if (this.offline.has(person))
      throw new Error('Fictional network disconnected')
    if (!this.users[person]) return reply(401, { error: 'unauthorized' })
    const path = url.pathname.replace(/^\/(?:upload\/)?drive\/v3\//, '')
    if (path === 'about') return reply(200, { user: this.users[person] })
    if (path === 'files/generateIds')
      return reply(200, {
        ids: ['fictional-file-' + String(++this.counter).padStart(8, '0')],
      })
    if (path === 'files' && method === 'POST') {
      let meta, packet
      if (url.searchParams.has('uploadType')) {
        const parts = String(options.body).split('\r\n\r\n')
        meta = JSON.parse(parts[1].split('\r\n--')[0])
        packet = JSON.parse(parts[2].split('\r\n--')[0])
        if (this.files.has(meta.id)) return reply(409, { error: 'exists' })
      } else meta = JSON.parse(options.body)
      const parent = meta.parents?.[0]
      if (parent && !this.allowed(this.files.get(parent), person))
        return reply(403, { error: 'permission' })
      const id =
          meta.id ??
          'fictional-folder-' + String(++this.counter).padStart(8, '0'),
        file = {
          ...meta,
          id,
          owner: person,
          shared: new Set(),
          packet,
          trashed: false,
          capabilities: { canAddChildren: true },
        }
      this.files.set(id, file)
      this.selected[person].add(id)
      if (this.failAfterCreate && packet) {
        this.failAfterCreate = false
        throw new Error('Fictional lost upload response')
      }
      return reply(200, { id, name: file.name })
    }
    if (path === 'files' && method === 'GET') {
      const folder = /'([^']+)' in parents/.exec(url.searchParams.get('q'))?.[1]
      if (!this.allowed(this.files.get(folder), person))
        return reply(403, { error: 'permission' })
      return reply(200, {
        files: [...this.files.values()]
          .filter(
            (f) =>
              f.parents?.[0] === folder &&
              f.appProperties?.lockboxProof === 'v1' &&
              !f.trashed,
          )
          .map((f) => ({
            id: f.id,
            parents: f.parents,
            appProperties: f.appProperties,
          })),
      })
    }
    const match = /^files\/([^/]+)(\/permissions)?$/.exec(path)
    if (!match) return reply(404, { error: 'not-found' })
    const file = this.files.get(match[1])
    if (!this.allowed(file, person)) return reply(403, { error: 'permission' })
    if (match[2]) {
      if (method === 'GET')
        return reply(200, { permissions: this.permissions(file) })
      if (file.owner !== person) return reply(403, { error: 'permission' })
      const email = JSON.parse(options.body).emailAddress,
        target = Object.keys(this.users).find(
          (p) => this.users[p].emailAddress === email,
        )
      if (!target) return reply(400, { error: 'invalid-person' })
      file.shared.add(target)
      return reply(200, { id: this.users[target].permissionId })
    }
    return reply(
      200,
      url.searchParams.get('alt') === 'media'
        ? file.packet
        : {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            parents: file.parents,
            appProperties: file.appProperties,
            trashed: file.trashed,
            capabilities: file.capabilities,
          },
    )
  }
}
