import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import type { RuntimeServices } from "../src/types";
import { json, memoryEnv } from "./helpers";

function services(): RuntimeServices {
  return { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() };
}

async function mcp(app: ReturnType<typeof createApp>, url: string, message: Record<string, unknown>) {
  const response = await app.fetch(new Request(`${url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(message),
  }));
  return { response, body: response.status === 202 ? null : await json<Record<string, unknown>>(response) };
}

describe("temporary MCP read surface", () => {
  it("negotiates, lists, and reads workspace resources", async () => {
    const app = createApp(memoryEnv(), services());
    const createdResponse = await app.fetch(new Request("https://optimizer.test/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "agent-understanding", windowHours: 6 }),
    }));
    const created = await json<{ id: string; uploadToken: string; shareUrl: string }>(createdResponse);
    const form = new FormData();
    form.set("file", new File(["Hello MCP"], "hello.txt", { type: "text/plain" }));
    await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.uploadToken}` },
      body: form,
    }));

    const initialized = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(initialized.response.status).toBe(200);
    expect((initialized.body?.result as Record<string, unknown>).protocolVersion).toBe("2025-03-26");

    const listed = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 2, method: "resources/list", params: {} });
    const resources = (listed.body?.result as { resources: Array<{ uri: string; name: string }> }).resources;
    expect(resources.some((resource) => resource.name === "manifest.json")).toBe(true);
    expect(resources.every((resource) => !resource.uri.includes(created.shareUrl.split("/").pop() ?? "never"))).toBe(true);

    const manifestUri = resources.find((resource) => resource.name === "manifest.json")?.uri;
    const read = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: manifestUri } });
    const contents = (read.body?.result as { contents: Array<{ text?: string }> }).contents;
    expect(contents[0].text).toContain("native-text");
  });

  it("exposes read-only projection tools and rejects unsafe arguments", async () => {
    const app = createApp(memoryEnv(), services());
    const createdResponse = await app.fetch(new Request("https://optimizer.test/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "token-saving", windowHours: 1 }) }));
    const created = await json<{ id: string; uploadToken: string; shareUrl: string }>(createdResponse);
    const form = new FormData();
    form.set("file", new File(["# Handoff"], "note.md", { type: "text/markdown" }));
    await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}` }, body: form }));

    const listed = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
    const tools = (listed.body?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toContain("read_projection");
    const called = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "read_projection", arguments: { name: "handoff.md" } } });
    expect(JSON.stringify(called.body)).toContain("Agent File Optimizer handoff");
    const unsafe = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "read_original", arguments: { path: "../../secret" } } });
    expect(unsafe.body?.error).toBeDefined();
  });

  it("round-trips encoded original paths through resource URIs", async () => {
    const app = createApp(memoryEnv(), services());
    const createdResponse = await app.fetch(new Request("https://optimizer.test/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }) }));
    const created = await json<{ id: string; uploadToken: string; shareUrl: string }>(createdResponse);
    const form = new FormData();
    form.set("path", "folder/notes#1.txt");
    form.set("file", new File(["Encoded path"], "notes#1.txt", { type: "text/plain" }));
    await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}` }, body: form }));
    const listed = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 7, method: "resources/list", params: {} });
    const resources = (listed.body?.result as { resources: Array<{ uri: string; name: string }> }).resources;
    const original = resources.find((resource) => resource.name === "folder/notes#1.txt");
    expect(original?.uri).toContain("notes%231.txt");
    const read = await mcp(app, created.shareUrl, { jsonrpc: "2.0", id: 8, method: "resources/read", params: { uri: original?.uri } });
    expect(JSON.stringify(read.body)).toContain("Encoded path");
  });
});
