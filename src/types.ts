export type WorkspaceWindowHours = 1 | 6 | 12;

export type Intent =
  | "agent-understanding"
  | "structured-data"
  | "token-saving"
  | "share-originals";

export type BillingClass = "free-native" | "external" | "unsupported";

export interface ProcessingSummary {
  billingClass: BillingClass;
  externalProcessing: boolean;
  amountUsd: number | null;
  message: string;
}

export type WorkspaceStatus = "ready" | "revoked" | "expired";

export type SafetyStatus = "basic-check-passed" | "basic-check-warning";

export interface SafetyAssessment {
  status: SafetyStatus;
  scanner: "basic-heuristics-only";
  signals: string[];
  disclaimer: string;
}

export interface SourceOrigin {
  kind: "upload" | "public-repository";
  locator?: string;
}

export interface WorkspaceRecord {
  id: string;
  uploadTokenHash: string;
  shareTokenHash: string;
  createdAt: string;
  expiresAt: string;
  windowHours: WorkspaceWindowHours;
  intent: Intent;
  status: WorkspaceStatus;
  /** Set once every stored object for the workspace has been deleted. Null while cleanup is still pending. */
  purgedAt?: string | null;
}

export interface SourceFileRecord {
  workspaceId: string;
  path: string;
  contentType: string;
  bytes: number;
  sha256: string;
  uploadedAt: string;
  parserId: string;
  billingClass: BillingClass;
  warnings: string[];
  safety: SafetyAssessment;
  origin: SourceOrigin;
}

export interface StoredObject {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface ProjectionBundle {
  objects: StoredObject[];
  files: SourceFileRecord[];
}

export interface WorkspacePublicView {
  id: string;
  status: WorkspaceStatus;
  createdAt: string;
  expiresAt: string;
  windowHours: WorkspaceWindowHours;
  intent: Intent;
  fileCount: number;
  shareUrl: string;
  projections: string[];
  preflight: ProcessingSummary;
}

export interface WorkspaceCreateResponse extends WorkspacePublicView {
  uploadToken: string;
  uploadUrl: string;
}

export type AppEnv = {
  FILES?: Env["FILES"];
  DB?: Env["DB"];
  ADMIN_TOKEN?: string;
  /** Optional Cloudflare rate-limit binding. Absent in local tests and on copies that remove it. */
  RATE_LIMITER?: RateLimit;
  APP_BASE_URL?: string;
  APP_ENV?: string;
};

export interface RuntimeServices {
  store: WorkspaceStore;
  blobs: BlobStore;
}

export interface WorkspaceStore {
  create(record: WorkspaceRecord): Promise<void>;
  get(id: string): Promise<WorkspaceRecord | null>;
  findByShareTokenHash(hash: string): Promise<WorkspaceRecord | null>;
  /** Workspaces whose content may still exist: revoked or expired, or past their window, and not yet purged. Oldest first, at most `limit` (default 200) so one scheduled run stays bounded. */
  listNeedingPurge(now: string, limit?: number): Promise<WorkspaceRecord[]>;
  setStatus(id: string, status: WorkspaceStatus): Promise<void>;
  markPurged(id: string, purgedAt: string): Promise<void>;
  putFile(record: SourceFileRecord): Promise<void>;
  listFiles(workspaceId: string): Promise<SourceFileRecord[]>;
  deleteFiles(workspaceId: string): Promise<void>;
}

export interface BlobStore {
  put(object: StoredObject): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  list(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}
