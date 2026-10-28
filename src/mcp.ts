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

/** An agent client takes one tool answer of about 25,000 tokens and cuts off the rest, so a long text is handed over a part at a time. */
export const PART_CHARS = 60_000;

/** Where each part of a long text starts. Parts end at a blank line when there is one in the back half of the window, else at a line end, else anywhere. */
export function partStarts(text: string, size = PART_CHARS): number[] {
  const starts = [0];
  let start = 0;
  while (text.length - start > size * 1.25) {
    const hard = start + size;
    let cut = text.lastIndexOf("\n\n", hard);
    if (cut < start + size * 0.5) cut = text.lastIndexOf("\n", hard);
    if (cut < start + size * 0.5) cut = hard;
    start = cut === hard ? cut : cut + (text.startsWith("\n\n", cut) ? 2 : 1);
    starts.push(start);
  }
  return starts;
}

function partResult(object: StoredObject, uri: string, part: number | undefined): { error: string } | { result: Record<string, unknown> } {
  const whole = { result: { content: [{ type: "resource", resource: resourceContent(object, uri) }], isError: false } };
  if (!isText(object.contentType)) return whole;
  const text = new TextDecoder().decode(object.bytes);
  const starts = partStarts(text);
  if (starts.length === 1 && (part === undefined || part === 1)) return whole;
  const wanted = part ?? 1;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > starts.length) return { error: `There ${starts.length === 1 ? "is only 1 part" : `are only ${starts.length} parts`}; part must be between 1 and ${starts.length}.` };
  const from = starts[wanted - 1];
  const to = wanted < starts.length ? starts[wanted] : text.length;
  const note = `[Part ${wanted} of ${starts.length} · characters ${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")}${wanted < starts.length ? ` · ask for part ${wanted + 1} to continue` : " · end"}]`;
  return {
    result: {
      content: [{ type: "text", text: `${note}\n\n${text.slice(from, to)}` }],
      structuredContent: { part: wanted, parts: starts.length, characters: text.length, uri },
      isError: false,
    },
  };
}

const tools = [
  {
    name: "read_projection",
    description: "Read one generated projection from this temporary workspace. A long text comes back a part at a time: the first part says how many there are, and `part` asks for another.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", enum: [...PROJECTION_NAMES], description: "Projection filename." },
        part: { type: "integer", minimum: 1, description: "Which part of a long text to read. Default 1. A text under about 75,000 characters comes back whole." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "read_original",
    description: "Read a preserved original file by its relative path. A long text file comes back a part at a time.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Safe relative path from the uploaded workspace." },
        part: { type: "integer", minimum: 1, description: "Which part of a long text file to read. Default 1." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

function partArgument(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

async function callTool(services: RuntimeServices, workspace: WorkspaceRecord, params: Record<string, unknown>, id: RequestId): Promise<Response> {
  const name = params.name;
  const args = record(params.arguments);
  if (name === "read_projection") {
    const projection = args.name;
    if (typeof projection !== "string" || !PROJECTION_NAMES.includes(projection as (typeof PROJECTION_NAMES)[number])) return rpcError(id, -32602, "Unknown projection name.");
    const uri = resourceUri(workspace.id, "projection", projection);
    const object = await services.blobs.get(projectionKey(workspace.id, projection));
    if (!object) return rpcResult(id, { content: [{ type: "text", text: "Projection not found." }], isError: true });
    const result = partResult(object, uri, partArgument(args.part));
    return "error" in result ? rpcError(id, -32602, result.error) : rpcResult(id, result.result);
  }
  if (name === "read_original") {
    if (typeof args.path !== "string") return rpcError(id, -32602, "Original path is required.");
    let path: string;
    try { path = normalizeRelativePath(args.path); } catch { return rpcError(id, -32602, "Original path must be a safe relative path."); }
    const uri = resourceUri(workspace.id, "original", path);
    const object = await services.blobs.get(originalKey(workspace.id, path));
    if (!object) return rpcResult(id, { content: [{ type: "text", text: "Original file not found." }], isError: true });
    const result = partResult(object, uri, partArgument(args.part));
    return "error" in result ? rpcError(id, -32602, result.error) : rpcResult(id, result.result);
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
