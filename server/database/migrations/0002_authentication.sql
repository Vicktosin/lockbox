-- Phase 2 account metadata only. No existing migration is changed and no users are seeded.
ALTER TABLE sessions ADD COLUMN device_label TEXT NOT NULL DEFAULT 'Unknown browser' CHECK(length(device_label) BETWEEN 1 AND 80);
ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '' CHECK(length(user_agent) <= 160);
ALTER TABLE account_tokens ADD COLUMN invite_role TEXT CHECK(invite_role IS NULL OR invite_role IN ('administrator','member'));
CREATE TRIGGER invite_role_insert BEFORE INSERT ON account_tokens
WHEN (NEW.purpose = 'invite' AND NEW.invite_role IS NULL) OR (NEW.purpose <> 'invite' AND NEW.invite_role IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'INVITE_ROLE_INVALID'); END;
CREATE TRIGGER invite_role_update BEFORE UPDATE OF purpose,invite_role ON account_tokens
WHEN (NEW.purpose = 'invite' AND NEW.invite_role IS NULL) OR (NEW.purpose <> 'invite' AND NEW.invite_role IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'INVITE_ROLE_INVALID'); END;
