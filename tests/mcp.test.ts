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

describe("long text over MCP", () => {
  async function workspaceWith(app: ReturnType<typeof createApp>, name: string, body: string) {
    const created = await json<{ id: string; uploadToken: string; shareUrl: string }>(
      await app.fetch(new Request("https://optimizer.test/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }) })),
    );
    const form = new FormData();
    form.set("file", new File([body], name, { type: "text/markdown" }));
    await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}` }, body: form }));
    return created;
  }
  const call = (app: ReturnType<typeof createApp>, url: string, args: Record<string, unknown>, tool = "read_projection") => mcp(app, url, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: tool, arguments: args } });

  it("hands a long projection over a part at a time, losing nothing", async () => {
    const app = createApp(memoryEnv(), services());
    const paragraphs = Array.from({ length: 900 }, (_, index) => `Paragraph ${index}: ${"word ".repeat(40).trim()}.`);
    const created = await workspaceWith(app, "long.md", paragraphs.join("\n\n"));

    const first = await call(app, created.shareUrl, { name: "content.md" });
    const firstResult = first.body?.result as { content: Array<{ type: string; text: string }>; structuredContent: { parts: number; characters: number } };
    expect(firstResult.content[0].type).toBe("text");
    expect(firstResult.content[0].text).toMatch(/^\[Part 1 of \d+ · characters 0–[\d,]+ of [\d,]+ · ask for part 2 to continue\]/);
    expect(firstResult.content[0].text.length).toBeLessThan(65_000);

    const whole = (await (await app.fetch(new Request(`${created.shareUrl}/content.md`))).text());
    const pieces: string[] = [];
    for (let part = 1; part <= firstResult.structuredContent.parts; part += 1) {
      const result = (await call(app, created.shareUrl, { name: "content.md", part })).body?.result as { content: Array<{ text: string }> };
      pieces.push(result.content[0].text.replace(/^\[Part[^\]]*\]\n\n/, ""));
    }
    expect(pieces.join("")).toBe(whole);
    expect(firstResult.structuredContent.parts).toBeGreaterThan(2);

    const beyond = await call(app, created.shareUrl, { name: "content.md", part: 99 });
    expect((beyond.body?.error as { code: number; message: string }).code).toBe(-32602);
    expect((beyond.body?.error as { message: string }).message).toContain("parts");
  });

  it("returns a short text whole, as before", async () => {
    const app = createApp(memoryEnv(), services());
    const created = await workspaceWith(app, "short.md", "# Short");
    const result = (await call(app, created.shareUrl, { name: "content.md" })).body?.result as { content: Array<{ type: string }> };
    expect(result.content[0].type).toBe("resource");
    const handoff = (await call(app, created.shareUrl, { name: "handoff.md" })).body?.result as { content: Array<{ resource: { text: string } }> };
    expect(handoff.content[0].resource.text).not.toContain("part at a time");
  });

  it("says in the handoff when the content is long", async () => {
    const app = createApp(memoryEnv(), services());
    const created = await workspaceWith(app, "long.md", Array.from({ length: 400 }, (_, index) => `Line ${index} ${"x".repeat(200)}`).join("\n\n"));
    const handoff = (await call(app, created.shareUrl, { name: "handoff.md" })).body?.result as { content: Array<{ resource?: { text: string }; text?: string }> };
    const text = handoff.content[0].resource?.text ?? handoff.content[0].text ?? "";
    expect(text).toContain("read_projection");
    expect(text).toContain("a part at a time");
  });
});
