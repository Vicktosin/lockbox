-- Account recovery is independent of client vault recovery.
CREATE TABLE login_recovery (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 token_digest BLOB NOT NULL UNIQUE CHECK(length(token_digest)=32),
 created_at INTEGER NOT NULL,
 consumed_at INTEGER
) STRICT;
CREATE TABLE vault_history (
 id INTEGER PRIMARY KEY,
 vault_id TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 scope TEXT NOT NULL CHECK(scope IN ('personal','shared')),
 revision INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 key_check TEXT,
 saved_at INTEGER NOT NULL,
 pinned INTEGER NOT NULL DEFAULT 1 CHECK(pinned IN (0,1))
) STRICT;
CREATE INDEX vault_history_lookup ON vault_history(vault_id,id DESC);
CREATE TRIGGER preserve_vault_revision BEFORE UPDATE OF payload ON client_vaults
WHEN OLD.payload <> NEW.payload
BEGIN
 INSERT INTO vault_history(vault_id,owner_id,scope,revision,payload,key_check,saved_at)
 VALUES(OLD.id,OLD.owner_id,OLD.scope,OLD.revision,OLD.payload,OLD.key_check,unixepoch()*1000);
END;
CREATE TABLE maintenance_policy (
 id INTEGER PRIMARY KEY CHECK(id=1),
 backup_days INTEGER NOT NULL DEFAULT 30 CHECK(backup_days BETWEEN 7 AND 365),
 history_days INTEGER NOT NULL DEFAULT 90 CHECK(history_days BETWEEN 7 AND 3650)
) STRICT;
INSERT INTO maintenance_policy(id) VALUES(1);
CREATE TABLE backup_runs (
 id TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL,
 verified_at INTEGER,
 filename TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','verified','failed'))
) STRICT;
