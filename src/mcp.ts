import { normalizeRelativePath } from "./path";
import { PROJECTION_NAMES, originalKey, projectionKey, settleWorkspace, shareTokenRecord } from "./lifecycle";
import type { RuntimeServices, SourceFileRecord, StoredObject, WorkspaceRecord } from "./types";

const PROTOCOL_VERSION = "2025-03-26";

type RequestId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: RequestId;
  method?: unknown;
  params?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function responseBody(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function rpcResult(id: RequestId, result: unknown): Response {
  return responseBody({ jsonrpc: "2.0", id, result });
}

function rpcError(id: RequestId, code: number, message: string, data?: unknown): Response {
  return responseBody({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }, 200);
}

function resourceUri(workspaceId: string, kind: "projection" | "original", path: string): string {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `agent-file://${workspaceId}/${kind}/${encodedPath}`;
}

function resourcePath(uri: string, workspaceId: string): { key: string; name: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== "agent-file:" || parsed.hostname !== workspaceId) return null;
  const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (path.startsWith("projection/")) {
    const name = path.slice("projection/".length);
    return PROJECTION_NAMES.includes(name as (typeof PROJECTION_NAMES)[number]) ? { key: projectionKey(workspaceId, name), name } : null;
  }
  if (path.startsWith("original/")) {
    const name = normalizeRelativePath(path.slice("original/".length));
    return { key: originalKey(workspaceId, name), name };
  }
  return null;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isText(contentType: string): boolean {
  return contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml");
}

function resourceContent(object: StoredObject, uri: string): Record<string, unknown> {
  if (isText(object.contentType)) return { uri, mimeType: object.contentType, text: new TextDecoder().decode(object.bytes) };
  return { uri, mimeType: object.contentType, blob: base64(object.bytes) };
}

async function readResource(services: RuntimeServices, workspace: WorkspaceRecord, uri: string): Promise<Record<string, unknown> | null> {
  let resolved: { key: string; name: string } | null;
  try {
    resolved = resourcePath(uri, workspace.id);
  } catch {
    return null;
  }
  if (!resolved) return null;
  const object = await services.blobs.get(resolved.key);
  return object ? resourceContent(object, uri) : null;
}

function projectionResources(workspace: WorkspaceRecord): Array<Record<string, unknown>> {
  return PROJECTION_NAMES.map((name) => ({
    uri: resourceUri(workspace.id, "projection", name),
    name,
    description: name === "handoff.md" ? "Human-readable orientation for the temporary workspace." : "Generated agent-facing workspace projection.",
    mimeType: name.endsWith(".json") || name.endsWith(".jsonl") ? "application/json" : name.endsWith(".md") ? "text/markdown" : "text/plain",
  }));
}

function originalResources(workspace: WorkspaceRecord, files: SourceFileRecord[]): Array<Record<string, unknown>> {
  return files.map((file) => ({
    uri: resourceUri(workspace.id, "original", file.path),
    name: file.path,
    description: "Preserved original file.",
    mimeType: file.contentType,
    size: file.bytes,
  }));
}

const tools = [
  {
    name: "read_projection",
    description: "Read one generated projection from this temporary workspace.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", enum: [...PROJECTION_NAMES], description: "Projection filename." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "read_original",
    description: "Read a preserved original file by its relative path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Safe relative path from the uploaded workspace." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

async function callTool(services: RuntimeServices, workspace: WorkspaceRecord, params: Record<string, unknown>, id: RequestId): Promise<Response> {
  const name = params.name;
  const args = record(params.arguments);
  if (name === "read_projection") {
    const projection = args.name;
    if (typeof projection !== "string" || !PROJECTION_NAMES.includes(projection as (typeof PROJECTION_NAMES)[number])) return rpcError(id, -32602, "Unknown projection name.");
    const uri = resourceUri(workspace.id, "projection", projection);
    const content = await readResource(services, workspace, uri);
    if (!content) return rpcResult(id, { content: [{ type: "text", text: "Projection not found." }], isError: true });
    return rpcResult(id, { content: [{ type: "resource", resource: content }], isError: false });
  }
  if (name === "read_original") {
    if (typeof args.path !== "string") return rpcError(id, -32602, "Original path is required.");
    let path: string;
    try { path = normalizeRelativePath(args.path); } catch { return rpcError(id, -32602, "Original path must be a safe relative path."); }
    const uri = resourceUri(workspace.id, "original", path);
    const content = await readResource(services, workspace, uri);
    if (!content) return rpcResult(id, { content: [{ type: "text", text: "Original file not found." }], isError: true });
    return rpcResult(id, { content: [{ type: "resource", resource: content }], isError: false });
  }
  return rpcError(id, -32601, `Unknown tool: ${String(name)}`);
}

export async function handleMcpRequest(request: Request, services: RuntimeServices): Promise<Response> {
  if (request.method !== "POST") return responseBody({ error: "MCP endpoint accepts POST JSON-RPC requests." }, 405);
  const workspace = await shareTokenRecord(request, services.store);
  if (!workspace) return responseBody({ error: "Share link not found." }, 404);
  if (workspace.status !== "ready") return responseBody({ error: "Share link expired or revoked." }, 410);
  if (Date.parse(workspace.expiresAt) <= Date.now()) {
    await settleWorkspace(workspace, services, "expired");
    return responseBody({ error: "Share link expired or revoked." }, 410);
  }

  let message: JsonRpcRequest;
  try {
    const body: unknown = await request.json();
    if (Array.isArray(body)) return rpcError(null, -32600, "JSON-RPC batches are not supported by this stateless endpoint.");
    message = record(body) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Invalid JSON.");
  }
  const id = message.id ?? null;
  if (message.jsonrpc !== "2.0") return rpcError(id, -32600, "Only JSON-RPC 2.0 requests are supported.");
  const method = typeof message.method === "string" ? message.method : null;
  if (!method) return rpcError(id, -32600, "A JSON-RPC method is required.");
  if (method === "notifications/initialized" || method === "notifications/cancelled") return responseBody(null, 202);
  if (method === "ping") return rpcResult(id, {});
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { resources: {}, tools: {} },
      serverInfo: { name: "agent-file-optimizer", version: "0.1.0" },
      instructions: "This is a stateless, read-only view of a temporary workspace. Read handoff.md first. The workspace expires at the time documented there.",
    });
  }
  if (method === "resources/list") {
    const files = await services.store.listFiles(workspace.id);
    return rpcResult(id, { resources: [...projectionResources(workspace), ...originalResources(workspace, files)] });
  }
  if (method === "resources/read") {
    const uri = record(message.params).uri;
    if (typeof uri !== "string") return rpcError(id, -32602, "A resource URI is required.");
    const content = await readResource(services, workspace, uri);
    return content ? rpcResult(id, { contents: [content] }) : rpcError(id, -32002, "Resource not found.", { uri });
  }
  if (method === "tools/list") return rpcResult(id, { tools });
  if (method === "tools/call") return callTool(services, workspace, record(message.params), id);
  return rpcError(id, -32601, `Method not found: ${method}`);
}

export { PROTOCOL_VERSION };
