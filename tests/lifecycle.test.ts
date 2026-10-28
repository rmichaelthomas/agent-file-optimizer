import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { expireDue, PROJECTION_NAMES, projectionKey } from "../src/lifecycle";
import { MemoryBlobStore, R2BlobStore } from "../src/storage";
import { MemoryWorkspaceStore, PURGE_BATCH } from "../src/store";
import type { BlobStore, RuntimeServices, StoredObject } from "../src/types";
import { json, memoryEnv } from "./helpers";

/** A blob store whose deletions fail until `failures` is exhausted. */
class FlakyBlobStore extends MemoryBlobStore {
  failures = 0;

  override async deletePrefix(prefix: string): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("simulated R2 outage");
    }
    await super.deletePrefix(prefix);
  }
}

/** A blob store that revokes the workspace during the first write, simulating a racing revoke. */
class RevokeOnFirstWriteBlobStore extends MemoryBlobStore {
  onFirstPut: (() => Promise<void>) | null = null;

  override async put(object: StoredObject): Promise<void> {
    const hook = this.onFirstPut;
    this.onFirstPut = null;
    if (hook) await hook();
    await super.put(object);
  }
}

function setup(blobs: BlobStore = new MemoryBlobStore()) {
  const services: RuntimeServices = { store: new MemoryWorkspaceStore(), blobs };
  const app = createApp(memoryEnv(), services);
  return { services, app };
}

async function create(app: ReturnType<typeof createApp>, windowHours = 6) {
  const response = await app.fetch(new Request("https://optimizer.test/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "agent-understanding", windowHours }),
  }));
  return json<{ id: string; uploadToken: string; uploadUrl: string; shareUrl: string; expiresAt: string }>(response);
}

async function upload(app: ReturnType<typeof createApp>, created: { uploadUrl: string; uploadToken: string }, name = "notes.md", body = "# Notes\n") {
  const form = new FormData();
  form.set("file", new File([body], name, { type: "text/markdown" }));
  return app.fetch(new Request(created.uploadUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${created.uploadToken}` },
    body: form,
  }));
}

async function blobKeys(blobs: BlobStore, prefix: string): Promise<string[]> {
  return (await blobs.list(prefix)).map((object) => object.key);
}

describe("revocation and expiry cleanup", () => {
  it("retries content deletion when an earlier revoke failed partway", async () => {
    const blobs = new FlakyBlobStore();
    const { services, app } = setup(blobs);
    const created = await create(app);
    expect((await upload(app, created)).status).toBe(201);
    const id = created.id;

    blobs.failures = 1;
    const first = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${id}/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.uploadToken}` },
    }));
    expect(first.status).toBe(500);
    expect(await blobKeys(blobs, `workspaces/${id}/`)).not.toEqual([]);

    const second = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${id}/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.uploadToken}` },
    }));
    expect(second.status).toBe(200);
    expect(await blobKeys(blobs, `workspaces/${id}/`)).toEqual([]);
    expect(await services.store.listFiles(id)).toEqual([]);
  });

  it("lets the scheduled cleanup finish an expired workspace whose first purge failed", async () => {
    const blobs = new FlakyBlobStore();
    const { services, app } = setup(blobs);
    const created = await create(app, 1);
    expect((await upload(app, created)).status).toBe(201);

    blobs.failures = 1;
    const later = new Date(Date.parse(created.expiresAt) + 1000);
    await expireDue(services, later);
    expect(await blobKeys(blobs, `workspaces/${created.id}/`)).not.toEqual([]);

    await expireDue(services, later);
    expect(await blobKeys(blobs, `workspaces/${created.id}/`)).toEqual([]);
  });

  it("does not leave content behind when a revoke lands while an upload is writing", async () => {
    const blobs = new RevokeOnFirstWriteBlobStore();
    const { app } = setup(blobs);
    const created = await create(app);
    blobs.onFirstPut = async () => {
      const revoked = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${created.uploadToken}` },
      }));
      expect(revoked.status).toBe(200);
    };

    const response = await upload(app, created);
    expect(response.status).toBe(410);
    expect(await blobKeys(blobs, `workspaces/${created.id}/`)).toEqual([]);
  });
});

describe("R2 blob store cleanup", () => {
  it("deletes more than one bulk-delete batch of objects", async () => {
    const stored = new Map<string, Uint8Array>();
    const bucket = {
      async put(key: string, value: Uint8Array) { stored.set(key, value); },
      async get(key: string) {
        const value = stored.get(key);
        return value ? { arrayBuffer: async () => value.buffer, httpMetadata: {} } : null;
      },
      async list({ prefix, cursor }: { prefix: string; cursor?: string }) {
        const keys = [...stored.keys()].filter((key) => key.startsWith(prefix)).sort();
        const start = cursor ? Number(cursor) : 0;
        const page = keys.slice(start, start + 500);
        const next = start + page.length;
        return { objects: page.map((key) => ({ key })), truncated: next < keys.length, cursor: String(next) };
      },
      async delete(keys: string | string[]) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (list.length > 1000) throw new Error("R2 bulk delete accepts at most 1000 keys");
        for (const key of list) stored.delete(key);
      },
    };
    const store = new R2BlobStore(bucket as unknown as R2Bucket);
    for (let index = 0; index < 1200; index += 1) {
      await store.put({ key: `workspaces/w/original/f${index}.txt`, bytes: new Uint8Array([1]), contentType: "text/plain" });
    }
    await store.deletePrefix("workspaces/w/");
    expect(stored.size).toBe(0);
  });
});

describe("request limits", () => {
  it("rejects a multi-file request whose combined size exceeds the request limit", async () => {
    const { app } = setup();
    const created = await create(app);
    const form = new FormData();
    const chunk = new Uint8Array(10 * 1024 * 1024);
    for (let index = 0; index < 6; index += 1) form.append("file", new File([chunk], `big-${index}.bin`));
    const response = await app.fetch(new Request(created.uploadUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${created.uploadToken}` },
      body: form,
    }));
    expect(response.status).toBe(413);
  });
});

describe("content types", () => {
  it("serves an untyped Markdown upload as readable text through MCP", async () => {
    const { app } = setup();
    const created = await create(app);
    const form = new FormData();
    form.set("file", new File(["# Plain note\n"], "note.md", { type: "" }));
    const uploaded = await app.fetch(new Request(created.uploadUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${created.uploadToken}` },
      body: form,
    }));
    expect(uploaded.status).toBe(201);
    const response = await app.fetch(new Request(`${created.shareUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_original", arguments: { path: "note.md" } } }),
    }));
    const body = await json<{ result: { content: Array<{ resource: { text?: string; blob?: string } }> } }>(response);
    expect(body.result.content[0].resource.text).toBe("# Plain note\n");
    expect(body.result.content[0].resource.blob).toBeUndefined();
  });
});

/** Records any moment a projection is missing while another is being written. */
class ProbingBlobStore extends MemoryBlobStore {
  probing = false;
  missing: string[] = [];

  override async put(object: StoredObject): Promise<void> {
    if (this.probing && object.key.includes("/projections/")) {
      const workspace = object.key.split("/")[1];
      for (const name of PROJECTION_NAMES) {
        if (!(await this.get(projectionKey(workspace, name)))) this.missing.push(name);
      }
    }
    await super.put(object);
  }
}

describe("projection refresh", () => {
  it("never leaves a projection missing while a later upload rewrites them", async () => {
    const blobs = new ProbingBlobStore();
    const { app } = setup(blobs);
    const created = await create(app);
    expect((await upload(app, created, "one.md", "# One\n")).status).toBe(201);
    blobs.probing = true;
    expect((await upload(app, created, "two.md", "# Two\n")).status).toBe(201);
    expect(blobs.missing).toEqual([]);
  });

  it("ends with every file in the handoff when two uploads overlap", async () => {
    const { app } = setup();
    const created = await create(app);
    const results = await Promise.all([upload(app, created, "a.md", "# A\n"), upload(app, created, "b.md", "# B\n")]);
    expect(results.map((response) => response.status)).toEqual([201, 201]);
    const manifest = await json<{ files: Array<{ path: string }> }>(await app.fetch(new Request(`${created.shareUrl}/manifest.json`)));
    expect(manifest.files.map((file) => file.path).sort()).toEqual(["a.md", "b.md"]);
  });
});

describe("scheduled purge", () => {
  it("takes at most one batch per pass and finishes the rest on the next", async () => {
    const services: RuntimeServices = { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() };
    const total = PURGE_BATCH * 2 + 100;
    for (let index = 0; index < total; index += 1) {
      await services.store.create({
        id: `w${index}`,
        uploadTokenHash: "u",
        shareTokenHash: `s${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        expiresAt: new Date(Date.UTC(2026, 0, 1, 1, 0, index % 60)).toISOString(),
        windowHours: 1,
        intent: "agent-understanding",
        status: "ready",
      });
    }
    const now = new Date(Date.UTC(2026, 5, 1));
    expect(await expireDue(services, now)).toBe(PURGE_BATCH);
    expect(await expireDue(services, now)).toBe(PURGE_BATCH);
    expect(await expireDue(services, now)).toBe(100);
    expect(await expireDue(services, now)).toBe(0);
  });
});

describe("projection refresh cost", () => {
  it("does not re-read the originals of files it has already parsed", async () => {
    class CountingBlobStore extends MemoryBlobStore {
      originalReads: string[] = [];
      override async get(key: string) {
        if (key.includes("/original/")) this.originalReads.push(key);
        return super.get(key);
      }
    }
    const blobs = new CountingBlobStore();
    const { app } = setup(blobs);
    const created = await create(app);
    await upload(app, created, "one.md", "# One\n");
    await upload(app, created, "two.md", "# Two\n");
    blobs.originalReads = [];
    await upload(app, created, "three.md", "# Three\n");
    expect(blobs.originalReads.filter((key) => key.endsWith("one.md") || key.endsWith("two.md"))).toEqual([]);
    const manifest = await json<{ files: Array<{ path: string }> }>(await app.fetch(new Request(`${created.shareUrl}/manifest.json`)));
    expect(manifest.files.map((file) => file.path).sort()).toEqual(["one.md", "three.md", "two.md"]);
  });

  it("serves a long projection over HTTP a part at a time", async () => {
    const { app } = setup();
    const created = await create(app);
    const paragraph = `${"word ".repeat(100)}\n\n`;
    expect((await upload(app, created, "long.md", paragraph.repeat(400))).status).toBe(201);
    const first = await app.fetch(new Request(`${created.shareUrl}/content.md?part=1`));
    expect(first.status).toBe(200);
    const parts = Number(first.headers.get("x-part")?.split("/")[1]);
    expect(parts).toBeGreaterThan(1);
    expect((await first.text()).startsWith(`[Part 1 of ${parts}`)).toBe(true);
    const last = await app.fetch(new Request(`${created.shareUrl}/content.md?part=${parts}`));
    expect((await last.text()).startsWith(`[Part ${parts} of ${parts}`)).toBe(true);
    expect((await app.fetch(new Request(`${created.shareUrl}/content.md?part=${parts + 1}`))).status).toBe(400);
    const whole = await (await app.fetch(new Request(`${created.shareUrl}/content.md`))).text();
    expect(whole.startsWith("[Part")).toBe(false);
    const handoff = await (await app.fetch(new Request(created.shareUrl))).text();
    expect(handoff).toContain("content.md?part=2");
  });

  it("names the files a ZIP left out in the handoff", async () => {
    const { app } = setup();
    const created = await create(app);
    const entries: Record<string, Uint8Array> = {};
    for (let index = 0; index < 120; index += 1) entries[`src/file-${String(index).padStart(3, "0")}.txt`] = strToU8(`file ${index}`);
    const form = new FormData();
    form.set("file", new File([zipSync(entries)], "repo.zip", { type: "application/zip" }));
    const response = await app.fetch(new Request(created.uploadUrl, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}` }, body: form }));
    expect(response.status).toBe(201);
    const handoff = await (await app.fetch(new Request(created.shareUrl))).text();
    expect(handoff).toContain("## Not fully read");
    expect(handoff).toContain("repo.zip");
    expect(handoff).toContain("20 archive member(s) were omitted");
    expect(handoff).toContain("First omitted:");
  });
});
