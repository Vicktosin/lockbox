export type ExtensionOperation = 'fill' | 'save' | 'update'
export interface ExtensionRequest {
  v: 1
  kind: 'lockbox-extension-request'
  id: string
  operation: ExtensionOperation
  origin: string
  entry?: { name: string; username: string; password: string }
}
export function websiteOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Use an HTTPS website without embedded credentials.')
  return url.origin
}
export function parseExtensionRequest(value: unknown): ExtensionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid extension request.')
  const item = value as Record<string, unknown>
  if (
    Object.keys(item).some(
      (k) => !['v', 'kind', 'id', 'operation', 'origin', 'entry'].includes(k),
    ) ||
    item.v !== 1 ||
    item.kind !== 'lockbox-extension-request' ||
    typeof item.id !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.id) ||
    !['fill', 'save', 'update'].includes(String(item.operation)) ||
    typeof item.origin !== 'string' ||
    item.origin.length > 2000 ||
    websiteOrigin(item.origin) !== item.origin
  )
    throw new Error('Invalid extension request.')
  if (item.operation !== 'fill') {
    const entry = item.entry as Record<string, unknown> | undefined
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'name,password,username'
    )
      throw new Error('Invalid captured login.')
    for (const [key, max] of Object.entries({
      name: 100,
      username: 200,
      password: 256,
    }))
      if (
        typeof entry[key] !== 'string' ||
        !(entry[key] as string).trim() ||
        (entry[key] as string).length > max
      )
        throw new Error('Invalid captured login.')
  } else if (item.entry !== undefined)
    throw new Error('Unexpected captured login.')
  return item as unknown as ExtensionRequest
}
