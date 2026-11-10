/** Compare wall-clock elapsed time too: background/suspended tabs must not extend unlock time. */
export class IdleLock {
  private last: number
  private active = true
  private now: () => number
  private onLock: () => void
  readonly timeout: number
  constructor(
    onLock: () => void,
    timeout = 5 * 60 * 1000,
    now: () => number = Date.now,
  ) {
    this.now = now
    this.last = now()
    this.onLock = onLock
    this.timeout = timeout
  }
  check() {
    if (this.active && this.now() - this.last >= this.timeout) {
      this.active = false
      this.onLock()
      return true
    }
    return !this.active
  }
  touch() {
    if (!this.check()) this.last = this.now()
  }
  stop() {
    this.active = false
  }
}
