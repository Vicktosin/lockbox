CREATE TABLE drive_connection (
  id INTEGER PRIMARY KEY CHECK(id=1),
  epoch TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('disconnected','connected','reauth-required')),
  folder_id TEXT,
  folder_name TEXT,
  resource_key TEXT,
  account_email TEXT,
  tokens TEXT CHECK(tokens IS NULL OR json_valid(tokens)),
  last_sync INTEGER,
  last_error TEXT,
  retry_at INTEGER,
  lease_owner TEXT,
  lease_until INTEGER
) STRICT;
CREATE TABLE drive_oauth_states (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  secret TEXT NOT NULL CHECK(json_valid(secret))
) STRICT;
CREATE TABLE drive_checkpoints (
  folder_id TEXT PRIMARY KEY,
  heads TEXT NOT NULL CHECK(json_valid(heads)),
  hashes TEXT NOT NULL CHECK(json_valid(hashes))
) STRICT;
CREATE TABLE drive_objects (
  folder_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('snapshot','commit')),
  digest TEXT NOT NULL,
  file_id TEXT NOT NULL,
  PRIMARY KEY(folder_id,kind,digest)
) STRICT;
CREATE TABLE drive_commit_cache (
  file_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  sealed TEXT NOT NULL CHECK(json_valid(sealed))
) STRICT;
CREATE TABLE drive_conflicts (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sealed TEXT NOT NULL CHECK(json_valid(sealed)),
  resolved_at INTEGER
) STRICT;
