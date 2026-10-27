/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import { json, memoryEnv } from "./helpers";

async function uploadPdf(env: Parameters<typeof memoryEnv>[0]) {
  const app = createApp(memoryEnv(env), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
  const created = await json<{ uploadUrl: string; uploadToken: string; shareUrl: string }>(
    await app.fetch(new Request("https://optimizer.test/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }),
    })),
  );
  const form = new FormData();
  form.append("file", new File([readFileSync(new URL("./fixtures/notes-quartz.pdf", import.meta.url))], "notes.pdf", { type: "application/pdf" }));
  const response = await app.fetch(new Request(created.uploadUrl, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}` }, body: form }));
  expect(response.status).toBe(201);
  const content = await (await app.fetch(new Request(`${created.shareUrl}/content.md`))).text();
  const manifest = await (await app.fetch(new Request(`${created.shareUrl}/manifest.json`))).text();
  return { content, manifest };
}

describe("DOCUMENT_READING", () => {
  it("reads a PDF by default", async () => {
    const { content } = await uploadPdf({});
    expect(content).toContain("Decided: ship Friday.");
  });

  it("keeps the original and says why when it is set to off", async () => {
    const { content, manifest } = await uploadPdf({ DOCUMENT_READING: "off" });
    expect(content).not.toContain("Decided: ship Friday.");
    expect(manifest).toContain("DOCUMENT_READING=off");
  });
});
