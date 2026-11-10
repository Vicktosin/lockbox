export class ProofError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ProofError'
    this.code = code
  }
}
export function check(condition, code = 'PROOF_INPUT_INVALID') {
  if (!condition) throw new ProofError(code)
}
