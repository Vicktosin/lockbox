# LOCKBOX

Lockbox is a Next.js application. Its React interface and server API routes are
deployed together; the web runtime does not use a separately hosted Fastify
server, SQLite database, or local filesystem for vault persistence.

## Storage and sign-in

Sign in with Google. Personal vault records are encrypted in the browser and
stored in the user's private Google Drive app-data area. The optional shared
Household vault is encrypted in a Google Drive folder that its owner chooses
and shares with invited Google accounts. The master password and decryption
keys stay on the device; short-lived Google access tokens are held in memory
only.

The app requests the narrow `openid`, `email`, `drive.file`, and `drive.appdata`
scopes. Google Identity Services and Drive Picker require public OAuth client
ID, API key, and Cloud project number settings. Restrict the API key to the
production website origin and required Google APIs. No Google client secret is
used by the web runtime.

The previous username/password accounts and SQLite data are not automatically
imported. Google sign-in creates a separate Drive-backed identity and vault;
existing data remains in its old storage until separately migrated.

Copy `.env.example` to `.env.local` and set:

```env
GOOGLE_CLIENT_ID=your-public-oauth-client-id
GOOGLE_API_KEY=your-restricted-browser-api-key
GOOGLE_APP_ID=your-google-cloud-project-number
```

Configure the OAuth client for the exact local and production web origins, and
enable the Google Drive API. The user-facing app cannot connect to Google until
these settings and Google's consent screen are configured.

## Local development

Use Node.js 22.12 or newer (or Node 24), then run:

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. `npm run build` creates the Next.js production
build, and `npm run start` serves it locally. `npm run typecheck` checks the
Next.js application. Legacy Fastify/SQLite sources and scripts remain in the
repository for backward compatibility; they are not part of the Next.js web
runtime.

## Vercel deployment

Import this repository into Vercel with the repository root as the project
root. Vercel detects Next.js and builds both the client interface and API
routes. Add the three Google settings above as environment variables for the
appropriate deployment environment, then deploy. No separate API host,
database provisioning, or persistent Vercel filesystem is required.

The current deployment needs a real Google application to verify OAuth, Picker
access, folder sharing, Drive concurrency behavior, and production CSP. These
live-provider checks and an independent security review are still required
before storing important credentials. Automated builds and tests are not
production-security certification.

See [the current architecture](docs/architecture.md) and
[Google Drive setup and data flow](docs/google-drive-integration.md).
