export class FoundationError extends Error {
  readonly code: string
  constructor(
    code: string,
    message = 'The backend foundation operation could not be completed safely.',
  ) {
    super(message)
    this.name = 'FoundationError'
    this.code = code
  }
}
export function fail(code: string): never {
  throw new FoundationError(code)
}
