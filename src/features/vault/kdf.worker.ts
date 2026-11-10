import { deriveMasterKey } from './kdf'
self.onmessage = async (
  event: MessageEvent<{ password: string; salt: Uint8Array }>,
) => {
  try {
    const key = await deriveMasterKey(event.data.password, event.data.salt)
    self.postMessage({ key })
    key.fill(0)
  } catch {
    self.postMessage({ error: true })
  }
}
