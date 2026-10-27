CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  upload_token_hash TEXT NOT NULL,
  share_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  window_hours INTEGER NOT NULL CHECK (window_hours IN (1, 6, 12)),
  intent TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'revoked', 'expired'))
);

CREATE INDEX IF NOT EXISTS workspaces_expiry_idx ON workspaces(status, expires_at);

CREATE TABLE IF NOT EXISTS source_files (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  parser_id TEXT NOT NULL,
  billing_class TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, path)
);
