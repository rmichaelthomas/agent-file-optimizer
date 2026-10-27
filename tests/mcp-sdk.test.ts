import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import { json, memoryEnv } from "./helpers";

// The official MCP SDK client, talking to the endpoint in-process. Other clients were checked by hand;
// see docs/examples/mcp-session.md.
describe("MCP endpoint with the official SDK client", () => {
  it("connects, lists, reads resources, and calls both tools", async () => {
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    const created = await json<{ uploadUrl: string; uploadToken: string; shareUrl: string }>(
      await app.fetch(new Request("https://optimizer.test/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }),
      })),
    );
    const form = new FormData();
    form.append("file", new File(["# Q3 plan\n\nShip it.\n"], "note.md"));
    form.append("path", "docs/note.md");
    await app.fetch(new Request(created.uploadUrl, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}` }, body: form }));

    const transport = new StreamableHTTPClientTransport(new URL(`${created.shareUrl}/mcp`), {
      fetch: (input, init) => app.fetch(new Request(input, init)),
    });
    const client = new Client({ name: "sdk-test", version: "0.0.1" });
    await client.connect(transport);
    try {
      const { resources } = await client.listResources();
      expect(resources.map((resource) => resource.name)).toEqual(expect.arrayContaining(["handoff.md", "manifest.json", "docs/note.md"]));
      const handoff = await client.readResource({ uri: resources[0].uri });
      expect(JSON.stringify(handoff.contents)).toContain("Agent File Optimizer handoff");

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["read_original", "read_projection"]);
      const original = await client.callTool({ name: "read_original", arguments: { path: "docs/note.md" } });
      expect(original.isError).toBe(false);
      expect(JSON.stringify(original.content)).toContain("Q3 plan");
      const missing = await client.callTool({ name: "read_original", arguments: { path: "nope.md" } });
      expect(missing.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
