ALTER TABLE workspaces ADD COLUMN purged_at TEXT;
CREATE INDEX IF NOT EXISTS workspaces_purge_idx ON workspaces(purged_at, status, expires_at);
