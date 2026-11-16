# Google identity and Drive storage

The current web application uses Google identity and Drive as its account and
vault storage providers. The Next.js App Router API routes run as part of the
same Vercel deployment as the React interface. They are stateless and do not
use SQLite, server-side sessions, or durable local files.

## Google configuration

Set these public browser configuration values in the Next.js deployment:

- `GOOGLE_CLIENT_ID`: OAuth 2.0 web client ID.
- `GOOGLE_API_KEY`: API key for Google Drive Picker, restricted to the deployed
  website origin and required APIs.
- `GOOGLE_APP_ID`: numeric Google Cloud project number used by Picker.

The same values may be placed in `.env.local` during local development. Do not
add a client secret or service-account key: this application uses Google's
browser OAuth token flow. Enable the Google Drive API and configure the OAuth
consent screen and exact website origins in Google Cloud. The web deployment
sets `Cross-Origin-Opener-Policy: same-origin-allow-popups` so Google Identity
Services can communicate with its OAuth popup.

Google matches JavaScript origins exactly. For local development, register
`http://localhost:3000` as an authorized JavaScript origin and open the app at
that address (`npm run dev` binds to it). `http://127.0.0.1:3000` is a different
origin; Google rejects it with `origin_mismatch`, which surfaces in Lockbox as a
failed or closed sign-in popup. The app redirects loopback-IP visits to
`localhost` for this reason.

The app requests only `openid`, `email`,
`https://www.googleapis.com/auth/drive.file`, and
`https://www.googleapis.com/auth/drive.appdata`. Google Identity Services
provides a short-lived access token to the browser. The browser keeps it in
memory, sends it as a bearer token to same-origin API routes, and drops it on
expiry or sign-out. The server verifies the token with Google's user-info
endpoint and uses it directly for Drive requests; it does not persist tokens
or create a server session.

This replaces the earlier username/password and SQLite-backed web accounts.
No automatic import of existing accounts or database records is provided; a
Google identity starts with its own Drive-backed vault.

## Data locations and access

- Personal profile and encrypted Personal vault data are stored as a private
  JSON file in that Google account's `appDataFolder`.
- Encrypted Household data is stored as a separate JSON file in the
  owner-selected Drive folder. The folder is selected or created using Google
  Picker; an ID alone is not treated as proof of access.
- The Household owner invites a Google email. The API grants that account
  writer permission on the folder. The invited account must sign in with that
  email and enter the Household key shared by the owner before it can decrypt
  the vault.
- Removing a joined member rotates the Household key, updates the encrypted
  profile and Household data, then removes that member's Drive permission.
  Previously copied secrets or ciphertext cannot be recalled.

Vault documents and master/recovery key wrappers are encrypted in the browser.
Google Drive stores ciphertext plus the minimum public metadata needed for
routing, revisions, and access control. The server does not receive the master
password or decryption keys.

## API and concurrency behavior

The Next.js API verifies Google identity for each request, validates the
selected folder, and limits file operations to the expected Personal app-data
file or Household file in that folder. Requests are same-origin, uncached, and
bounded in size. The server rejects malformed or oversized Drive documents
rather than treating them as empty vaults.

Vault updates use Drive ETags with `If-Match`. Missing ETags and failed
conditional updates are rejected; the app must not silently overwrite a newer
revision. Drive move and membership-revocation flows record pending state so a
later request can finish or report an interrupted update. Google Drive's
conditional-write and permission behavior still needs live testing; automated
tests alone do not validate provider semantics.

Up to 12 encrypted prior revisions are retained per vault for recovery of
deleted entries. This is a bounded in-file history, not an independent backup.
The user must maintain separate backups of anything they cannot afford to
lose.

## Deployment and remaining checks

Deploy the repository root as a Next.js project on Vercel and add the three
Google settings to the appropriate Vercel environments. The deployment does
not require a separate API service, database, or persistent filesystem. A
missing or malformed Google configuration leaves sign-in unavailable rather
than simulating a connected account.

No live OAuth client or API key is configured in this repository. Before
production use, validate Google consent, Picker selection, `drive.appdata`
access, shared-folder access for invited users, conditional updates, permission
revocation, rate limits, and production CSP with the real Google project.
Independent security review and restore testing remain necessary before
relying on Lockbox for important credentials.

References: [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/overview),
[Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[Drive API files](https://developers.google.com/workspace/drive/api/reference/rest/v3/files),
[Drive permissions](https://developers.google.com/workspace/drive/api/guides/manage-sharing).
