import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import type { RuntimeServices } from "../src/types";
import type { ExternalParserRunner } from "../src/parsers/types";
import { json, memoryEnv } from "./helpers";

function services(): RuntimeServices {
  return { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() };
}

async function createWorkspace(app: ReturnType<typeof createApp>, windowHours = 6) {
  const response = await app.fetch(
    new Request("https://optimizer.test/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "agent-understanding", windowHours }),
    }),
  );
  expect(response.status).toBe(201);
  return json<{
    id: string;
    uploadToken: string;
    shareUrl: string;
    expiresAt: string;
  }>(response);
}

describe("workspace HTTP API", () => {
  it("publishes the parser matrix and explicit processing policy", async () => {
    const app = createApp(memoryEnv(), services());
    const response = await app.fetch(new Request("https://optimizer.test/api/capabilities"));
    expect(response.status).toBe(200);
    const body = await json<{ parsers: Array<{ id: string }>; policy: { externalProcessing: string } }>(response);
    expect(body.parsers.map((parser) => parser.id)).toContain("native-pdf");
    expect(body.parsers.map((parser) => parser.id)).toContain("native-office-docx");
    expect(body.policy.externalProcessing).toBe("never-implicit");
  });

  it("creates, uploads, projects, and shares a file", async () => {
    const app = createApp(memoryEnv(), services());
    const created = await createWorkspace(app);
    const form = new FormData();
    form.set("file", new File(['{"hello":"world"}'], "data.json", { type: "application/json" }));

    const upload = await app.fetch(
      new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${created.uploadToken}` },
        body: form,
      }),
    );
    expect(upload.status).toBe(201);
    expect((await json<{ files: string[] }>(upload)).files).toEqual(["data.json"]);

    const handoff = await app.fetch(new Request(created.shareUrl));
    expect(handoff.status).toBe(200);
    expect(await handoff.text()).toContain("temporary");

    const manifest = await app.fetch(new Request(`${created.shareUrl}/manifest.json`));
    expect(manifest.status).toBe(200);
    expect(await manifest.text()).toContain("native-json");

    const original = await app.fetch(new Request(`${created.shareUrl}/original/data.json`));
    expect(original.status).toBe(200);
    expect(await original.text()).toBe('{"hello":"world"}');
  });

  it("keeps unsupported originals and reports the limitation", async () => {
    const app = createApp(memoryEnv(), services());
    const created = await createWorkspace(app, 1);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "brief.png", { type: "image/png" }));
    const upload = await app.fetch(
      new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${created.uploadToken}` },
        body: form,
      }),
    );
    expect(upload.status).toBe(201);
    const content = await app.fetch(new Request(`${created.shareUrl}/content.md`));
    expect(await content.text()).toMatch(/original file/i);
    const manifest = await app.fetch(new Request(`${created.shareUrl}/manifest.json`));
    expect(await manifest.text()).toMatch(/fallback-original-only/);
  });

  it("keeps external parsing opt-in and reports its billing class", async () => {
    let calls = 0;
    const runner: ExternalParserRunner = {
      id: "test-external",
      billingClass: "external",
      supports: ({ path }) => path.endsWith(".pdf"),
      parse: async () => { calls += 1; return { parserId: "test-external", billingClass: "external", confidence: "medium", text: "Runner result", jsonl: [], warnings: ["External processing was explicitly enabled."] }; },
    };
    const app = createApp(memoryEnv(), services(), { allowExternalProcessing: true, externalParserRunner: runner });
    const created = await createWorkspace(app);
    const form = new FormData();
    form.set("file", new File(["%PDF"], "brief.pdf", { type: "application/pdf" }));
    const upload = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}` }, body: form }));
    expect(upload.status).toBe(201);
    const body = await json<{ processing: { billingClass: string; externalProcessing: boolean; amountUsd: number | null } }>(upload);
    expect(body.processing.billingClass).toBe("external");
    expect(body.processing.externalProcessing).toBe(true);
    expect(body.processing.amountUsd).toBeNull();
    expect(calls).toBe(1);
    const manifest = await app.fetch(new Request(`${created.shareUrl}/manifest.json`));
    expect(await manifest.text()).toContain('"externalProcessing": true');
  });

  it("rejects bad windows and path traversal", async () => {
    const app = createApp(memoryEnv(), services());
    const bad = await app.fetch(
      new Request("https://optimizer.test/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "agent-understanding", windowHours: 24 }),
      }),
    );
    expect(bad.status).toBe(400);

    const created = await createWorkspace(app);
    const form = new FormData();
    form.set("path", "../../secret.txt");
    form.set("file", new File(["secret"], "secret.txt", { type: "text/plain" }));
    const upload = await app.fetch(
      new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${created.uploadToken}` },
        body: form,
      }),
    );
    expect(upload.status).toBe(400);
  });

  it("revokes access and deletes content immediately", async () => {
    const blobStore = new MemoryBlobStore();
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: blobStore });
    const created = await createWorkspace(app);
    const form = new FormData();
    form.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
    await app.fetch(
      new Request(`https://optimizer.test/api/workspaces/${created.id}/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${created.uploadToken}` },
        body: form,
      }),
    );
    const revoke = await app.fetch(
      new Request(`https://optimizer.test/api/workspaces/${created.id}/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${created.uploadToken}` },
      }),
    );
    expect(revoke.status).toBe(200);
    expect((await blobStore.list(`workspaces/${created.id}/`)).length).toBe(0);
    const status = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/status`, { headers: { authorization: `Bearer ${created.uploadToken}` } }));
    expect(status.status).toBe(200);
    const statusBody = await json<{ fileCount: number; shareUrl?: string }>(status);
    expect(statusBody.fileCount).toBe(0);
    expect(statusBody.shareUrl).toBeUndefined();
    expect((await app.fetch(new Request(created.shareUrl))).status).toBe(410);
  });
});

describe("internal errors", () => {
  it("log the route prefix and error name, never a token", async () => {
    const store = new MemoryWorkspaceStore();
    const app = createApp(memoryEnv(), { store, blobs: new MemoryBlobStore() });
    const workspace = await createWorkspace(app);
    const shareToken = workspace.shareUrl.split("/s/")[1];
    store.findByShareTokenHash = async () => {
      throw new Error("boom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.fetch(new Request(workspace.shareUrl));
    expect(response.status).toBe(500);
    const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
    spy.mockRestore();
    expect(logged).toContain("request failed: GET /s/");
    expect(logged).not.toContain(shareToken);
    expect(logged).not.toContain(workspace.uploadToken);
  });
});
