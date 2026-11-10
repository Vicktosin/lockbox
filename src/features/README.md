# Feature modules

- `auth/`: real account forms, cookie-backed session gate, API client and account-scoped session controls.
- `vault/`: client Argon2id/worker, authenticated encryption, key wrapping/recovery, encrypted snapshot engine, lock gate, folders and Household controls.
- `drive/`: actual connection/status/sync/conflict controls; Google credentials never enter the frontend. Deployment registration is a developer dependency, not a user form.
- `credentials/`: mock models, fixtures, reusable list and badge components, detail/add/edit/delete dialogs and display helpers.
- `dashboard/`: sample overview and vault/security summaries.
- `generator/`: transient local password generation and controls.
- `settings/`: profile simulation, appearance and future security/device placeholders.

Keep domain behavior with its feature. The authenticated app uses the encrypted vault engine and never persists decrypted keys/credentials or session secrets in browser storage. The demo workspace remains only for regression tests. Drive connection status comes from the real backend; missing registration/consent never reports connected.
