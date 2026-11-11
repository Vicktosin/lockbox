import { check } from './errors.mjs'
/** Read-back stays native and is used only to avoid erasing unrelated clipboard content. */
export class SecretClipboard {
  constructor(clipboard, delay = 30000, onFailure = () => {}) {
    this.clipboard = clipboard
    this.delay = delay
    this.onFailure = onFailure
    this.owned = null
  }
  copy(value) {
    check(
      typeof value === 'string' && value.length <= 65536,
      'PROOF_CLIPBOARD_INVALID',
    )
    this.clear()
    this.clipboard.writeText(value)
    this.owned = value
    this.timer = setTimeout(() => this.clear(), this.delay)
    this.timer.unref?.()
  }
  clear() {
    clearTimeout(this.timer)
    const value = this.owned
    this.owned = null
    try {
      if (value !== null && this.clipboard.readText() === value)
        this.clipboard.writeText('')
      return true
    } catch {
      this.onFailure()
      return false
    }
  }
}
