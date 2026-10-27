import { createTokenPair, hashBytes, hashToken, tokensMatch } from "./crypto";
import { PROJECTION_NAMES, analysisKey, bearerToken, cacheParsedResult, originalKey, projectionKey, settleWorkspace, publicView, refreshProjections, shareTokenRecord, summarizeProcessing, uploadTokenMatches, type ProjectionOptions } from "./lifecycle";
import { getParserCapabilities, isWorkspaceWindowHours, type ExternalParserRunner } from "./parsers/types";
import { parseWithBestParser } from "./parsers/native";
import { handleMcpRequest } from "./mcp";
import { renderSharePage } from "./render";
import { basicSafetyCheck } from "./safety";
import { downloadPublicRepository, maxRepositoryBytes, parsePublicRepositoryUrl } from "./repository";
import { normalizeRelativePath } from "./path";
import { contentTypeFor } from "./mime";
import type { AppEnv, Intent, RuntimeServices, SourceFileRecord, WorkspaceCreateResponse, WorkspaceRecord } from "./types";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 200;
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const intents: Intent[] = ["agent-understanding", "structured-data", "token-saving", "share-originals"];

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}

function errorResponse(status: number, message: string): Response {
  return json({ error: status === 410 ? "workspace_unavailable" : "request_error", message }, status);
}

function intentIsValid(value: unknown): value is Intent {
  return typeof value === "string" && intents.includes(value as Intent);
}

function urlFor(request: Request, env: AppEnv, path: string): string {
  const base = env.APP_BASE_URL ?? new URL(request.url).origin;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function safeContentType(file: File, path: string): string {
  return contentTypeFor(path, file.type);
}

function projectionName(pathname: string, token: string): string | null {
  const prefix = `/s/${token}/`;
  if (!pathname.startsWith(prefix)) return null;
  const name = pathname.slice(prefix.length);
  return ["handoff.md", "manifest.json", "tree.txt", "content.md", "content.jsonl"].includes(name) ? name : null;
}

async function workspaceFromId(id: string, services: RuntimeServices): Promise<WorkspaceRecord | null> {
  return services.store.get(id);
}

async function ingestBytes(
  services: RuntimeServices,
  workspaceId: string,
  path: string,
  contentType: string,
  bytes: Uint8Array,
  origin: SourceFileRecord["origin"],
  parserOptions: ProjectionOptions,
): Promise<{ record: SourceFileRecord; warnings: string[] }> {
  const sha256 = await hashBytes(bytes);
  const input = { path, contentType, bytes };
  const parsed = await parseWithBestParser(input, parserOptions);
  const safety = basicSafetyCheck(path, contentType, bytes);
  const record: SourceFileRecord = {
    workspaceId,
    path,
    contentType,
    bytes: bytes.byteLength,
    sha256,
    uploadedAt: new Date().toISOString(),
    parserId: parsed.parserId,
    billingClass: parsed.billingClass,
    warnings: parsed.warnings,
    safety,
    origin,
  };
  const previous = (await services.store.listFiles(workspaceId)).find((file) => file.path === path);
  if (previous && previous.sha256 !== sha256) await services.blobs.delete(analysisKey(workspaceId, previous.sha256));
  await services.blobs.put({ key: originalKey(workspaceId, path), bytes, contentType });
  const runnerId = parserOptions.allowExternal && parserOptions.externalRunner?.supports(input) ? parserOptions.externalRunner.id : null;
  await cacheParsedResult(services, workspaceId, sha256, parsed, runnerId);
  await services.store.putFile(record);
  return { record, warnings: [...parsed.warnings, ...safety.signals] };
}

/**
 * Writes are awaited before this check runs, so if the workspace is still
 * ready here, any later revoke or expiry purge will delete what was written.
 * If it is no longer ready, purge again so nothing written during the race survives.
 */
async function writesRacedRevocation(id: string, services: RuntimeServices): Promise<boolean> {
  const current = await services.store.get(id);
  if (!current || (current.status === "ready" && Date.parse(current.expiresAt) > Date.now())) return false;
  await settleWorkspace(current, services, current.status === "revoked" ? "revoked" : "expired");
  return true;
}

async function createWorkspace(request: Request, env: AppEnv, services: RuntimeServices): Promise<Response> {
  // A blank secret (for example, an empty answer in the deploy form) must not leave the deployment open.
  if (env.ADMIN_TOKEN === "") return errorResponse(503, "ADMIN_TOKEN is set but empty. Set a value, or remove the variable for local use.");
  if (env.ADMIN_TOKEN) {
    const provided = bearerToken(request);
    const valid = provided ? tokensMatch(await hashToken(provided), await hashToken(env.ADMIN_TOKEN)) : false;
    if (!valid) return errorResponse(401, "This deployment requires an admin token to create a workspace.");
  }
  let body: { intent?: unknown; windowHours?: unknown };
  try {
    body = (await request.json()) as { intent?: unknown; windowHours?: unknown };
  } catch {
    return errorResponse(400, "Send JSON with an intent and a 1, 6, or 12 hour window.");
  }
  if (!intentIsValid(body.intent) || !isWorkspaceWindowHours(body.windowHours)) {
    return errorResponse(400, "Choose a supported intent and a retention window of 1, 6, or 12 hours.");
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + body.windowHours * 60 * 60 * 1000);
  const id = crypto.randomUUID();
  const tokens = await createTokenPair();
  const record: WorkspaceRecord = {
    id,
    uploadTokenHash: tokens.uploadTokenHash,
    shareTokenHash: tokens.shareTokenHash,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    windowHours: body.windowHours,
    intent: body.intent,
    status: "ready",
  };
  await services.store.create(record);
  // Write the projections now, so an empty workspace has a handoff that says so, instead of a 404.
  await refreshProjections(record, services);
  const shareUrl = urlFor(request, env, `/s/${tokens.shareToken}`);
  const uploadUrl = urlFor(request, env, `/api/workspaces/${id}/upload`);
  const response: WorkspaceCreateResponse = {
    ...publicView(record, 0, shareUrl),
    uploadToken: tokens.uploadToken,
    uploadUrl,
  };
  return json(response, 201);
}

async function uploadFiles(request: Request, services: RuntimeServices, id: string, parserOptions: ProjectionOptions): Promise<Response> {
  const workspace = await workspaceFromId(id, services);
  if (!workspace) return errorResponse(404, "Workspace not found.");
  if (!(await uploadTokenMatches(request, workspace))) return errorResponse(401, "A valid workspace upload token is required.");
  if (workspace.status !== "ready" || Date.parse(workspace.expiresAt) <= Date.now()) {
    if (workspace.status === "ready") await settleWorkspace(workspace, services, "expired");
    return errorResponse(410, "This workspace has expired or been revoked.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "Upload a multipart form with one or more file fields.");
  }
  const files = form.getAll("file").filter((value): value is File => value instanceof File);
  const paths = form.getAll("path").map(String);
  if (files.length === 0) return errorResponse(400, "No file was included in the upload.");
  if (files.length > MAX_FILES_PER_REQUEST) return errorResponse(413, `Upload at most ${MAX_FILES_PER_REQUEST} files in one request.`);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_REQUEST_BYTES) {
    return errorResponse(413, `Files in one request may total at most ${MAX_REQUEST_BYTES / (1024 * 1024)} MiB. Split the upload into smaller batches.`);
  }
  if (files.some((file) => file.size > MAX_UPLOAD_BYTES)) {
    return errorResponse(413, `This MVP accepts files up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB each. Split larger files into separate uploads, or share them another way and add only the smaller ones here.`);
  }

  const uploaded: string[] = [];
  const warnings: string[] = [];
  for (const [index, file] of files.entries()) {
    let path: string;
    try {
      path = normalizeRelativePath(paths.length === files.length ? paths[index] : file.name);
    } catch {
      return errorResponse(400, "Each file path must be a safe relative path.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ingested = await ingestBytes(services, id, path, safeContentType(file, path), bytes, { kind: "upload" }, parserOptions);
    uploaded.push(path);
    warnings.push(...ingested.warnings);
  }

  const bundle = await refreshProjections(workspace, services, parserOptions);
  if (await writesRacedRevocation(id, services)) return errorResponse(410, "This workspace has expired or been revoked.");
  return json({
    id,
    files: uploaded,
    projections: bundle.objects.map((object) => object.key.split("/").pop()),
    warnings: [...new Set(warnings)],
    safety: {
      statuses: bundle.files.map((file) => file.safety.status),
      message: "Basic heuristics only; this is not a malware verdict.",
    },
    processing: summarizeProcessing(bundle.files),
    message: "Files preserved and projections refreshed. Use the share link returned when the workspace was created.",
  }, 201);
}

async function importPublicRepository(request: Request, services: RuntimeServices, id: string, parserOptions: ProjectionOptions): Promise<Response> {
  const workspace = await workspaceFromId(id, services);
  if (!workspace) return errorResponse(404, "Workspace not found.");
  if (!(await uploadTokenMatches(request, workspace))) return errorResponse(401, "A valid workspace upload token is required.");
  if (workspace.status !== "ready" || Date.parse(workspace.expiresAt) <= Date.now()) {
    if (workspace.status === "ready") await settleWorkspace(workspace, services, "expired");
    return errorResponse(410, "This workspace has expired or been revoked.");
  }
  let body: { url?: unknown };
  try { body = (await request.json()) as { url?: unknown }; } catch { return errorResponse(400, "Send JSON with a public GitHub repository URL."); }
  if (typeof body.url !== "string") return errorResponse(400, "A public GitHub repository URL is required.");
  let repository;
  try { repository = parsePublicRepositoryUrl(body.url); } catch (error) { return errorResponse(400, error instanceof Error ? error.message : "That repository URL is not allowed."); }
  let downloaded;
  try { downloaded = await downloadPublicRepository(repository); } catch (error) { return errorResponse(502, error instanceof Error ? error.message : "The public repository could not be downloaded."); }
  const ingested = await ingestBytes(services, id, downloaded.path, downloaded.contentType, downloaded.bytes, { kind: "public-repository", locator: repository.canonicalUrl }, parserOptions);
  const bundle = await refreshProjections(workspace, services, parserOptions);
  if (await writesRacedRevocation(id, services)) return errorResponse(410, "This workspace has expired or been revoked.");
  return json({
    id,
    source: {
      provider: repository.provider,
      repository: repository.canonicalUrl,
      branch: downloaded.branch,
      externalFetch: true,
      externalProcessing: false,
      amountUsd: 0,
      message: "Public source fetched from GitHub with an explicit request. No paid parser or hidden provider was invoked.",
    },
    files: [ingested.record.path],
    projections: bundle.objects.map((object) => object.key.split("/").pop()),
    warnings: [...new Set(ingested.warnings)],
    processing: summarizeProcessing(bundle.files),
  }, 201);
}

async function workspaceStatus(request: Request, services: RuntimeServices, id: string): Promise<Response> {
  const workspace = await workspaceFromId(id, services);
  if (!workspace) return errorResponse(404, "Workspace not found.");
  if (!(await uploadTokenMatches(request, workspace))) return errorResponse(401, "A valid workspace upload token is required.");
  if (workspace.status === "ready" && Date.parse(workspace.expiresAt) <= Date.now()) {
    await settleWorkspace(workspace, services, "expired");
    return errorResponse(410, "This workspace has expired or been revoked.");
  }
  const files = await services.store.listFiles(id);
  const view = publicView(workspace, files.length, "");
  const { shareUrl: _shareUrl, ...status } = view;
  return json({ ...status, processing: summarizeProcessing(files) });
}

async function revokeWorkspace(request: Request, services: RuntimeServices, id: string): Promise<Response> {
  const workspace = await workspaceFromId(id, services);
  if (!workspace) return errorResponse(404, "Workspace not found.");
  if (!(await uploadTokenMatches(request, workspace))) return errorResponse(401, "A valid workspace upload token is required.");
  // Always run the purge, even when already revoked: an earlier attempt may have failed partway.
  const complete = await settleWorkspace(workspace, services, "revoked");
  if (!complete) {
    return json({ id, status: "revoked", purged: false, message: "Access is off, but some content could not be deleted yet. Revoke again to retry; scheduled cleanup will also retry." }, 500);
  }
  return json({ id, status: "revoked", purged: true, message: "Workspace content was deleted." });
}

// A person opening the link: the browser asks for a document and says so. Agent fetchers and curl do not send Sec-Fetch-Dest.
function isBrowserNavigation(request: Request): boolean {
  return request.headers.get("sec-fetch-dest") === "document" && (request.headers.get("accept") ?? "").includes("text/html");
}

async function share(request: Request, services: RuntimeServices): Promise<Response> {
  const workspace = await shareTokenRecord(request, services.store);
  if (!workspace) return errorResponse(404, "Share link not found.");
  if (workspace.status !== "ready") return errorResponse(410, "This share link has expired or been revoked.");
  if (Date.parse(workspace.expiresAt) <= Date.now()) {
    await settleWorkspace(workspace, services, "expired");
    return errorResponse(410, "This share link has expired.");
  }

  const pathname = new URL(request.url).pathname;
  const token = pathname.split("/")[2];
  const name = projectionName(pathname, token);
  const handoffName = name ?? (pathname === `/s/${token}` || pathname === `/s/${token}/` ? "handoff.md" : null);
  const key = handoffName ? projectionKey(workspace.id, handoffName) : pathname.startsWith(`/s/${token}/original/`) ? originalKey(workspace.id, normalizeRelativePath(decodeURIComponent(pathname.slice(`/s/${token}/original/`.length)))) : null;
  if (!key) return errorResponse(404, "That workspace resource was not found.");
  const object = await services.blobs.get(key);
  if (!object) return errorResponse(404, "That workspace resource was not found.");
  if (!name && handoffName === "handoff.md" && isBrowserNavigation(request)) {
    const base = `/s/${token}`;
    const page = renderSharePage(
      new TextDecoder().decode(object.bytes),
      [...PROJECTION_NAMES].map((projection) => ({ name: projection, href: `${base}/${projection}` })),
    );
    return new Response(page, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  }
  const body = new ArrayBuffer(object.bytes.byteLength);
  new Uint8Array(body).set(object.bytes);
  return new Response(body, {
    headers: {
      "content-type": object.contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

export interface AppOptions {
  allowExternalProcessing?: boolean;
  externalParserRunner?: ExternalParserRunner;
}

export function createApp(env: AppEnv, services: RuntimeServices, options: AppOptions = {}) {
  const parserOptions: ProjectionOptions = {
    allowExternal: options.allowExternalProcessing === true,
    externalRunner: options.externalParserRunner,
  };
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      try {
        if (url.pathname === "/healthz" && request.method === "GET") return json({ ok: true, service: "agent-file-optimizer" });
        if (url.pathname === "/api/capabilities" && request.method === "GET") return json({
          parsers: getParserCapabilities(),
          policy: {
            externalProcessing: "never-implicit",
            unsupportedFormats: "original-only-with-warning",
            pricing: "free-native-in-MVP",
            retentionWindowsHours: [1, 6, 12],
            maxUploadBytesPerFile: MAX_UPLOAD_BYTES,
            maxFilesPerRequest: MAX_FILES_PER_REQUEST,
            maxUploadBytesPerRequest: MAX_REQUEST_BYTES,
            maxPublicRepositoryBytes: maxRepositoryBytes,
            enhancedScanning: "not-configured",
          },
        });
        if (url.pathname === "/api/workspaces" && request.method === "POST") return await createWorkspace(request, env, services);
        const uploadMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/upload$/);
        if (uploadMatch && request.method === "POST") return await uploadFiles(request, services, uploadMatch[1], parserOptions);
        const repositoryMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/import-public-repo$/);
        if (repositoryMatch && request.method === "POST") return await importPublicRepository(request, services, repositoryMatch[1], parserOptions);
        const statusMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/status$/);
        if (statusMatch && request.method === "GET") return await workspaceStatus(request, services, statusMatch[1]);
        const revokeMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/revoke$/);
        if (revokeMatch && request.method === "POST") return await revokeWorkspace(request, services, revokeMatch[1]);
        if (/^\/s\/[^/]+\/mcp$/.test(url.pathname)) return await handleMcpRequest(request, services);
        if (url.pathname.startsWith("/s/") && request.method === "GET") return await share(request, services);
        return errorResponse(404, "Not found.");
      } catch (error) {
        if (error instanceof URIError || (error instanceof Error && /path traversal|relative paths/i.test(error.message))) {
          return errorResponse(400, "That file path is not allowed.");
        }
        // Route class only. Share paths carry the bearer token as their second segment, so /s/… is logged as /s.
        console.error(`request failed: ${request.method} ${url.pathname.startsWith("/s/") ? "/s" : url.pathname.split("/").slice(0, 3).join("/")}/…: ${error instanceof Error ? error.name : "unknown error"}`);
        return errorResponse(500, "The workspace could not be processed.");
      }
    },
  };
}

export { MAX_UPLOAD_BYTES };
