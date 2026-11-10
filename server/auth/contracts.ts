/** Contracts only. None of these are implemented by the demo or scaffold. */
export interface AuthenticatedLockboxSession {
  /** Obtained from a verified server session, never a request body/header user ID. */
  userId: string
  householdId: string
  role: 'administrator' | 'member'
}
export interface SessionVerifier {
  /** Verify opaque Secure/HttpOnly cookie against durable server state, or reject. */
  requireSession(request: Request): Promise<AuthenticatedLockboxSession>
}
export interface OAuthAttemptStore {
  /** Persist a short-lived, one-use attempt bound to the verified administrator session. */
  put(attempt: {
    stateHash: string
    nonceHash: string
    sessionId: string
    pkceVerifierSecretRef: string
    expiresAt: string
  }): Promise<void>
  /** Atomically consume a matching attempt; reject missing, expired or reused state. */
  consume(
    stateHash: string,
    sessionId: string,
  ): Promise<{ nonceHash: string; pkceVerifierSecretRef: string }>
}
export interface GoogleGrantReference {
  householdId: string
  googleSubject: string
  /** Pointer into an encrypted backend store. Not the refresh token itself. */
  encryptedTokenRef: string
  scopes: readonly string[]
  status: 'connected' | 'reauthorization-required' | 'revoked'
}
export interface GoogleGrantStore {
  get(householdId: string): Promise<GoogleGrantReference | null>
  put(grant: GoogleGrantReference): Promise<void>
  revoke(householdId: string): Promise<void>
}
/** Future worker/provider consumes this server-only port; never return tokens to clients. */
export interface GoogleAccessTokenProvider {
  withAccessToken<T>(
    householdId: string,
    operation: (accessToken: string) => Promise<T>,
  ): Promise<T>
}
