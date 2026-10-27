// The D1 schema in its current shape. Every statement is idempotent, so the Worker can create a
// fresh database on first use, and an existing database that already ran migrations is left alone.
// The files in migrations/ remain the record of how the schema evolved. Keep this list in step with
// them: a new migration needs a matching change here.
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    upload_token_hash TEXT NOT NULL,
    share_token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    window_hours INTEGER NOT NULL CHECK (window_hours IN (1, 6, 12)),
    intent TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ready', 'revoked', 'expired')),
    purged_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS workspaces_expiry_idx ON workspaces(status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS workspaces_purge_idx ON workspaces(purged_at, status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS source_files (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    parser_id TEXT NOT NULL,
    billing_class TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    safety_json TEXT NOT NULL DEFAULT '{"status":"basic-check-passed","scanner":"basic-heuristics-only","signals":[],"disclaimer":"This is not a malware verdict."}',
    origin_json TEXT NOT NULL DEFAULT '{"kind":"upload"}',
    PRIMARY KEY (workspace_id, path)
  )`,
];

// One schema check per database binding per isolate. A failed check is forgotten, so the next request retries it.
const ensured = new WeakMap<D1Database, Promise<void>>();

export function ensureSchema(db: D1Database): Promise<void> {
  let ready = ensured.get(db);
  if (!ready) {
    ready = db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql))).then(
      () => undefined,
      (error: unknown) => {
        ensured.delete(db);
        throw error;
      },
    );
    ensured.set(db, ready);
  }
  return ready;
}
