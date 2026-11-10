-- No users, passwords, vault contents or production seeds are inserted.
CREATE TABLE app_metadata (
  name TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE encryption_key_checks (
  key_version TEXT PRIMARY KEY NOT NULL,
  check_value BLOB NOT NULL CHECK(length(check_value) = 32)
) STRICT;
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  username_display TEXT NOT NULL CHECK(length(username_display) BETWEEN 3 AND 32 AND username_display NOT GLOB '*[^A-Za-z0-9_]*'),
  username_canonical TEXT NOT NULL COLLATE BINARY UNIQUE CHECK(username_canonical = lower(username_display) AND username_canonical NOT GLOB '*[^a-z0-9_]*'),
  password_hash TEXT NOT NULL CHECK(length(password_hash) BETWEEN 1 AND 1024),
  role TEXT NOT NULL CHECK(role IN ('administrator', 'member')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  password_reset_required INTEGER NOT NULL DEFAULT 0 CHECK(password_reset_required IN (0,1)),
  recovery_email TEXT CHECK(recovery_email IS NULL OR length(recovery_email) BETWEEN 3 AND 320),
  recovery_email_verified_at INTEGER,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  CHECK(recovery_email IS NOT NULL OR recovery_email_verified_at IS NULL)
) STRICT;
CREATE UNIQUE INDEX one_active_administrator ON users(role) WHERE role = 'administrator' AND active = 1;
CREATE TRIGGER users_capacity_insert BEFORE INSERT ON users WHEN NEW.active = 1
BEGIN SELECT CASE WHEN (SELECT count(*) FROM users WHERE active = 1) >= 2 THEN RAISE(ABORT, 'HOUSEHOLD_CAPACITY') END; END;
CREATE TRIGGER users_capacity_update BEFORE UPDATE OF active ON users WHEN NEW.active = 1 AND OLD.active = 0
BEGIN SELECT CASE WHEN (SELECT count(*) FROM users WHERE active = 1) >= 2 THEN RAISE(ABORT, 'HOUSEHOLD_CAPACITY') END; END;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_digest BLOB NOT NULL UNIQUE CHECK(length(token_digest) = 32),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  CHECK(last_seen_at >= created_at AND idle_expires_at > last_seen_at AND absolute_expires_at > created_at)
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(absolute_expires_at);
CREATE TABLE account_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_digest BLOB NOT NULL UNIQUE CHECK(length(token_digest) = 32),
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK(purpose IN ('password-reset','verify-email','invite')),
  pending_email TEXT CHECK(pending_email IS NULL OR length(pending_email) BETWEEN 3 AND 320),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  consumed_at INTEGER CHECK(consumed_at IS NULL OR consumed_at >= created_at),
  CHECK(purpose = 'invite' OR user_id IS NOT NULL)
) STRICT;
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);
CREATE TABLE encrypted_payloads (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version = 1),
  key_version TEXT NOT NULL REFERENCES encryption_key_checks(key_version) ON DELETE RESTRICT,
  iv BLOB NOT NULL CHECK(length(iv) = 12),
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) BETWEEN 1 AND 65536),
  auth_tag BLOB NOT NULL CHECK(length(auth_tag) = 16),
  UNIQUE(key_version, iv)
) STRICT;
CREATE TABLE folders (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL CHECK(visibility IN ('personal','household')),
  encrypted_payload_id TEXT NOT NULL UNIQUE REFERENCES encrypted_payloads(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  UNIQUE(id,owner_id)
) STRICT;
CREATE TABLE credentials (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  folder_id TEXT,
  visibility TEXT CHECK(visibility IN ('personal','household')),
  encrypted_payload_id TEXT NOT NULL UNIQUE REFERENCES encrypted_payloads(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  CHECK((folder_id IS NULL AND visibility IS NOT NULL) OR (folder_id IS NOT NULL AND visibility IS NULL)),
  FOREIGN KEY(folder_id,owner_id) REFERENCES folders(id,owner_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX credentials_owner ON credentials(owner_id);
CREATE INDEX credentials_folder ON credentials(folder_id);
CREATE VIEW credential_visibility AS
SELECT c.id, c.owner_id, c.encrypted_payload_id, c.version,
       CASE WHEN c.folder_id IS NULL THEN c.visibility ELSE f.visibility END AS visibility
FROM credentials c LEFT JOIN folders f ON f.id = c.folder_id AND f.owner_id = c.owner_id;
