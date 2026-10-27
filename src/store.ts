import type {
  SourceFileRecord,
  WorkspaceRecord,
  WorkspaceStatus,
  WorkspaceStore,
} from "./types";

/** Most workspaces one scheduled cleanup pass takes on. The rest wait for the next pass. */
export const PURGE_BATCH = 200;

export class MemoryWorkspaceStore implements WorkspaceStore {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly files = new Map<string, Map<string, SourceFileRecord>>();

  async create(record: WorkspaceRecord): Promise<void> {
    this.workspaces.set(record.id, { ...record });
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    const record = this.workspaces.get(id);
    return record ? { ...record } : null;
  }

  async findByShareTokenHash(hash: string): Promise<WorkspaceRecord | null> {
    for (const record of this.workspaces.values()) {
      if (record.shareTokenHash === hash) return { ...record };
    }
    return null;
  }

  async listNeedingPurge(now: string, limit = PURGE_BATCH): Promise<WorkspaceRecord[]> {
    const timestamp = Date.parse(now);
    return [...this.workspaces.values()]
      .filter((record) => !record.purgedAt && (record.status !== "ready" || Date.parse(record.expiresAt) <= timestamp))
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async setStatus(id: string, status: WorkspaceStatus): Promise<void> {
    const record = this.workspaces.get(id);
    if (record) this.workspaces.set(id, { ...record, status });
  }

  async markPurged(id: string, purgedAt: string): Promise<void> {
    const record = this.workspaces.get(id);
    if (record) this.workspaces.set(id, { ...record, purgedAt });
  }

  async putFile(record: SourceFileRecord): Promise<void> {
    const workspaceFiles = this.files.get(record.workspaceId) ?? new Map<string, SourceFileRecord>();
    workspaceFiles.set(record.path, { ...record, warnings: [...record.warnings], safety: { ...record.safety, signals: [...record.safety.signals] }, origin: { ...record.origin } });
    this.files.set(record.workspaceId, workspaceFiles);
  }

  async listFiles(workspaceId: string): Promise<SourceFileRecord[]> {
    return [...(this.files.get(workspaceId)?.values() ?? [])]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({ ...file, warnings: [...file.warnings], safety: { ...file.safety, signals: [...file.safety.signals] }, origin: { ...file.origin } }));
  }

  async deleteFiles(workspaceId: string): Promise<void> {
    this.files.delete(workspaceId);
  }
}

function rowToWorkspace(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    uploadTokenHash: String(row.upload_token_hash),
    shareTokenHash: String(row.share_token_hash),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    windowHours: Number(row.window_hours) as WorkspaceRecord["windowHours"],
    intent: String(row.intent) as WorkspaceRecord["intent"],
    status: String(row.status) as WorkspaceRecord["status"],
    purgedAt: row.purged_at ? String(row.purged_at) : null,
  };
}

export class D1WorkspaceStore implements WorkspaceStore {
  constructor(private readonly db: D1Database) {}

  async create(record: WorkspaceRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO workspaces
          (id, upload_token_hash, share_token_hash, created_at, expires_at, window_hours, intent, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.uploadTokenHash,
        record.shareTokenHash,
        record.createdAt,
        record.expiresAt,
        record.windowHours,
        record.intent,
        record.status,
      )
      .run();
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    const row = await this.db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first();
    return row ? rowToWorkspace(row) : null;
  }

  async findByShareTokenHash(hash: string): Promise<WorkspaceRecord | null> {
    const row = await this.db.prepare("SELECT * FROM workspaces WHERE share_token_hash = ?").bind(hash).first();
    return row ? rowToWorkspace(row) : null;
  }

  async listNeedingPurge(now: string, limit = PURGE_BATCH): Promise<WorkspaceRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM workspaces
         WHERE purged_at IS NULL AND (status <> 'ready' OR expires_at <= ?)
         ORDER BY expires_at
         LIMIT ?`,
      )
      .bind(now, limit)
      .all();
    return result.results.map(rowToWorkspace);
  }

  async setStatus(id: string, status: WorkspaceStatus): Promise<void> {
    await this.db.prepare("UPDATE workspaces SET status = ? WHERE id = ?").bind(status, id).run();
  }

  async markPurged(id: string, purgedAt: string): Promise<void> {
    await this.db.prepare("UPDATE workspaces SET purged_at = ? WHERE id = ?").bind(purgedAt, id).run();
  }

  async putFile(record: SourceFileRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO source_files
          (workspace_id, path, content_type, bytes, sha256, uploaded_at, parser_id, billing_class, warnings_json, safety_json, origin_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, path) DO UPDATE SET
           content_type = excluded.content_type,
           bytes = excluded.bytes,
           sha256 = excluded.sha256,
           uploaded_at = excluded.uploaded_at,
           parser_id = excluded.parser_id,
           billing_class = excluded.billing_class,
           warnings_json = excluded.warnings_json,
           safety_json = excluded.safety_json,
           origin_json = excluded.origin_json`,
      )
      .bind(
        record.workspaceId,
        record.path,
        record.contentType,
        record.bytes,
        record.sha256,
        record.uploadedAt,
        record.parserId,
        record.billingClass,
        JSON.stringify(record.warnings),
        JSON.stringify(record.safety),
        JSON.stringify(record.origin),
      )
      .run();
  }

  async listFiles(workspaceId: string): Promise<SourceFileRecord[]> {
    const result = await this.db
      .prepare("SELECT * FROM source_files WHERE workspace_id = ? ORDER BY path")
      .bind(workspaceId)
      .all();
    return result.results.map((row) => ({
      workspaceId,
      path: String(row.path),
      contentType: String(row.content_type),
      bytes: Number(row.bytes),
      sha256: String(row.sha256),
      uploadedAt: String(row.uploaded_at),
      parserId: String(row.parser_id),
      billingClass: String(row.billing_class) as SourceFileRecord["billingClass"],
      warnings: JSON.parse(String(row.warnings_json)) as string[],
      safety: JSON.parse(String(row.safety_json)) as SourceFileRecord["safety"],
      origin: JSON.parse(String(row.origin_json)) as SourceFileRecord["origin"],
    }));
  }

  async deleteFiles(workspaceId: string): Promise<void> {
    await this.db.prepare("DELETE FROM source_files WHERE workspace_id = ?").bind(workspaceId).run();
  }
}
