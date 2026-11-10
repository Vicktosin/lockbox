CREATE TABLE backup_destination (
 id INTEGER PRIMARY KEY CHECK(id=1),
 folder_id TEXT NOT NULL,
 folder_name TEXT NOT NULL,
 resource_key TEXT,
 last_success INTEGER,
 last_error TEXT,
 retry_at INTEGER,
 key_saved_at INTEGER,
 key_check TEXT NOT NULL
) STRICT;
CREATE TABLE backup_deliveries (
 backup_id TEXT PRIMARY KEY REFERENCES backup_runs(id) ON DELETE RESTRICT,
 folder_id TEXT NOT NULL,
 file_id TEXT NOT NULL,
 digest TEXT NOT NULL,
 verified_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0,
 error TEXT
) STRICT;
CREATE TABLE archived_history (
 id INTEGER PRIMARY KEY,
 vault_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('personal','shared')),
 revision INTEGER NOT NULL,
 saved_at INTEGER NOT NULL,
 backup_id TEXT NOT NULL REFERENCES backup_deliveries(backup_id) ON DELETE RESTRICT,
 digest TEXT NOT NULL
) STRICT;
CREATE INDEX archived_history_vault ON archived_history(vault_id,id DESC);
DROP TRIGGER preserve_vault_revision;
CREATE TRIGGER preserve_vault_revision BEFORE UPDATE OF payload ON client_vaults
WHEN OLD.payload <> NEW.payload
BEGIN
 INSERT INTO vault_history(id,vault_id,owner_id,scope,revision,payload,key_check,saved_at)
 VALUES((SELECT COALESCE(MAX(id),0)+1 FROM (SELECT id FROM vault_history UNION ALL SELECT id FROM archived_history)),OLD.id,OLD.owner_id,OLD.scope,OLD.revision,OLD.payload,OLD.key_check,unixepoch()*1000);
END;
