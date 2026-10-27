import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import type { RuntimeServices } from "../src/types";
import { json, memoryEnv } from "./helpers";

function services(): RuntimeServices {
  return { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() };
}

describe("a workspace with no files yet", () => {
  it("serves a handoff that explains it is empty, instead of a bare 404", async () => {
    const app = createApp(memoryEnv(), services());
    const created = await app.fetch(
      new Request("https://optimizer.test/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "agent-understanding", windowHours: 6 }),
      }),
    );
    expect(created.status).toBe(201);
    const { shareUrl } = await json<{ shareUrl: string }>(created);

    const handoff = await app.fetch(new Request(shareUrl));
    expect(handoff.status).toBe(200);
    const text = await handoff.text();
    expect(text).toContain("No files yet");
    expect(text).toContain("Files: **0**");

    const manifest = await app.fetch(new Request(`${shareUrl}/manifest.json`));
    expect(manifest.status).toBe(200);
  });

  it("still returns 410 once the empty workspace is revoked", async () => {
    const app = createApp(memoryEnv(), services());
    const created = await app.fetch(
      new Request("https://optimizer.test/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }),
      }),
    );
    const { id, uploadToken, shareUrl } = await json<{ id: string; uploadToken: string; shareUrl: string }>(created);
    await app.fetch(
      new Request(`https://optimizer.test/api/workspaces/${id}/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${uploadToken}` },
      }),
    );
    const after = await app.fetch(new Request(shareUrl));
    expect(after.status).toBe(410);
  });
});
