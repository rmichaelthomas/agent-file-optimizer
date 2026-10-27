import { hashToken, tokensMatch } from "./crypto";
import { parseWithBestParser } from "./parsers/native";
import type { ExternalParserRunner, ParsedFile, ParserInput } from "./parsers/types";
import { buildProjectionBundle, type ProjectionSource } from "./projections";
import { D1WorkspaceStore, MemoryWorkspaceStore } from "./store";
import { MemoryBlobStore, R2BlobStore } from "./storage";
import type { AppEnv, BillingClass, ProcessingSummary, RuntimeServices, WorkspacePublicView, WorkspaceRecord } from "./types";

export const PROJECTION_NAMES = ["handoff.md", "manifest.json", "tree.txt", "content.md", "content.jsonl"] as const;

export function workspacePrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/`;
}

export function originalKey(workspaceId: string, path: string): string {
  return `${workspacePrefix(workspaceId)}original/${path}`;
}

export function projectionKey(workspaceId: string, name: string): string {
  return `${workspacePrefix(workspaceId)}projections/${name}`;
}

export function analysisKey(workspaceId: string, sha256: string): string {
  return `${workspacePrefix(workspaceId)}analysis/${sha256}.json`;
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const [scheme, token] = value.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function uploadTokenMatches(request: Request, workspace: WorkspaceRecord): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;
  return tokensMatch(await hashToken(token), workspace.uploadTokenHash);
}

export async function shareTokenRecord(request: Request, store: RuntimeServices["store"]): Promise<WorkspaceRecord | null> {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/s\/([^/]+)/);
  if (!match) return null;
  return store.findByShareTokenHash(await hashToken(match[1]));
}

export interface ProjectionOptions {
  allowExternal?: boolean;
  externalRunner?: ExternalParserRunner;
}

interface ParsedCacheRecord {
  runnerId: string | null;
  parsed: ParsedFile;
}

async function readParsedCache(services: RuntimeServices, workspaceId: string, sha256: string): Promise<ParsedCacheRecord | null> {
  const object = await services.blobs.get(analysisKey(workspaceId, sha256));
  if (!object) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(object.bytes));
    if (value === null || typeof value !== "object" || !("parsed" in value) || !("runnerId" in value)) return null;
    const parsed = value.parsed;
    const runnerId = value.runnerId;
    if (parsed === null || typeof parsed !== "object" || typeof runnerId !== "string" && runnerId !== null) return null;
    if (!("parserId" in parsed) || !("billingClass" in parsed) || !("confidence" in parsed) || !("text" in parsed) || !("jsonl" in parsed) || !("warnings" in parsed)) return null;
    return { runnerId, parsed: parsed as ParsedFile };
  } catch {
    return null;
  }
}

export async function cacheParsedResult(services: RuntimeServices, workspaceId: string, sha256: string, parsed: ParsedFile, runnerId: string | null): Promise<void> {
  await services.blobs.put({
    key: analysisKey(workspaceId, sha256),
    bytes: new TextEncoder().encode(JSON.stringify({ runnerId, parsed })),
    contentType: "application/json; charset=utf-8",
  });
}

function parserInput(record: { path: string; contentType: string }, bytes: Uint8Array): ParserInput {
  return { path: record.path, contentType: record.contentType, bytes };
}

function expectedRunnerId(input: Pick<ParserInput, "path" | "contentType">, options: ProjectionOptions): string | null {
  return options.allowExternal && options.externalRunner?.supports(input) ? options.externalRunner.id : null;
}

const REFRESH_ATTEMPTS = 3;

function fileSignature(files: Array<{ path: string; sha256: string }>): string {
  return files.map((file) => `${file.path}:${file.sha256}`).sort().join("|");
}

/**
 * Rebuilds the readable projections. The five projection objects have fixed names, so each is
 * overwritten in place and a reader never sees a missing one. Two uploads can still overlap and the
 * slower one may write a view built from fewer files, so after writing it checks the file list
 * again and rebuilds if it changed.
 */
export async function refreshProjections(workspace: WorkspaceRecord, services: RuntimeServices, options: ProjectionOptions = {}): Promise<ReturnType<typeof buildProjectionBundle>> {
  let bundle: ReturnType<typeof buildProjectionBundle> | null = null;
  for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt += 1) {
    const files = await services.store.listFiles(workspace.id);
    const sources: ProjectionSource[] = [];
    for (const record of files) {
      // The parsed result is cached by content hash, so an unchanged file costs one small read here, not
      // a read of the original. The original is fetched only when it has to be parsed again.
      const runnerId = expectedRunnerId(record, options);
      const cached = await readParsedCache(services, workspace.id, record.sha256);
      if (cached && cached.runnerId === runnerId) {
        sources.push({ record, parsed: cached.parsed });
        continue;
      }
      const original = await services.blobs.get(originalKey(workspace.id, record.path));
      if (!original) continue;
      const parsed = await parseWithBestParser(parserInput(record, original.bytes), options);
      await cacheParsedResult(services, workspace.id, record.sha256, parsed, runnerId);
      sources.push({ record, parsed });
    }

    bundle = buildProjectionBundle(workspace, sources);
    for (const file of bundle.files) await services.store.putFile(file);
    await Promise.all(bundle.objects.map((object) => services.blobs.put(object)));
    if (fileSignature(await services.store.listFiles(workspace.id)) === fileSignature(files)) break;
  }
  return bundle as ReturnType<typeof buildProjectionBundle>;
}

/**
 * Turns access off first, then deletes every stored object and file row.
 * Idempotent: safe to call again after a partial failure. Throws if any
 * deletion fails, and leaves `purgedAt` unset so cleanup is retried later.
 */
export async function purgeWorkspace(workspace: WorkspaceRecord, services: RuntimeServices, status: "revoked" | "expired"): Promise<void> {
  if (workspace.status === "ready") await services.store.setStatus(workspace.id, status);
  await services.store.deleteFiles(workspace.id);
  await services.blobs.deletePrefix(workspacePrefix(workspace.id));
  await services.store.markPurged(workspace.id, new Date().toISOString());
}

/**
 * Purges from a request path. A failure here must not change the response the
 * caller is already returning (access is already off); the scheduled cleanup
 * retries anything left behind. Only the workspace id is logged.
 */
export async function settleWorkspace(workspace: WorkspaceRecord, services: RuntimeServices, status: "revoked" | "expired"): Promise<boolean> {
  try {
    await purgeWorkspace(workspace, services, status);
    return true;
  } catch (error) {
    console.error(`workspace cleanup incomplete; scheduled cleanup will retry (${workspace.id}): ${error instanceof Error ? error.name : "unknown error"}`);
    return false;
  }
}

/** Returns the number of workspaces fully purged in this pass. Failures are logged and retried on the next pass. */
export async function expireDue(services: RuntimeServices, now = new Date()): Promise<number> {
  const records = await services.store.listNeedingPurge(now.toISOString());
  let purged = 0;
  for (const record of records) {
    const status = record.status === "revoked" ? "revoked" : "expired";
    if (await settleWorkspace(record, services, status)) purged += 1;
  }
  return purged;
}

let localServices: RuntimeServices | null = null;

export function servicesForEnv(env: AppEnv): RuntimeServices {
  if (env.DB && env.FILES) return { store: new D1WorkspaceStore(env.DB), blobs: new R2BlobStore(env.FILES) };
  if (!localServices) localServices = { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() };
  return localServices;
}

export function publicView(record: WorkspaceRecord, fileCount: number, shareUrl: string): WorkspacePublicView {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    windowHours: record.windowHours,
    intent: record.intent,
    fileCount,
    shareUrl,
    projections: [...PROJECTION_NAMES],
    preflight: {
      billingClass: "free-native",
      externalProcessing: false,
      amountUsd: 0,
      message: "Native parsing and temporary delivery are free in this MVP. Unsupported formats stay original-only; no external parser is called automatically.",
    },
  };
}

export function summarizeProcessing(files: Array<{ billingClass: BillingClass }>): ProcessingSummary {
  const externalProcessing = files.some((file) => file.billingClass === "external");
  const unsupported = files.some((file) => file.billingClass === "unsupported");
  if (externalProcessing) {
    return {
      billingClass: "external",
      externalProcessing: true,
      amountUsd: null,
      message: "An explicitly enabled external parser handled at least one file. A provider quote is required before charging; review manifest provenance and warnings.",
    };
  }
  if (unsupported) {
    return {
      billingClass: "unsupported",
      externalProcessing: false,
      amountUsd: 0,
      message: "Native projections are free. Unsupported formats remain original-only and were not sent to an external service.",
    };
  }
  return {
    billingClass: "free-native",
    externalProcessing: false,
    amountUsd: 0,
    message: "Native projections and temporary delivery are free in this MVP.",
  };
}
