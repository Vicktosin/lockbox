-- Versioned client ciphertext. Phase 1 encrypted-payload tables remain reserved/unchanged.
CREATE TABLE client_vault_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.v') = 1)
) STRICT;
CREATE TABLE client_vaults (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('personal','shared')),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  key_check TEXT CHECK(key_check IS NULL OR json_valid(key_check)),
  CHECK((scope='personal' AND key_check IS NULL) OR (scope='shared' AND key_check IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_client_personal ON client_vaults(owner_id) WHERE scope='personal';
CREATE UNIQUE INDEX one_client_household ON client_vaults(scope) WHERE scope='shared';
CREATE TABLE client_vault_members (
  vault_id TEXT NOT NULL REFERENCES client_vaults(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined INTEGER NOT NULL DEFAULT 0 CHECK(joined IN (0,1)),
  PRIMARY KEY(vault_id,user_id)
) STRICT;
