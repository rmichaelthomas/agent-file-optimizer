import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import { json, memoryEnv } from "./helpers";
import { downloadPublicRepository, parsePublicRepositoryUrl } from "../src/repository";

describe("public repository connector", () => {
  it("accepts canonical GitHub repository URLs", () => {
    expect(parsePublicRepositoryUrl("https://github.com/example/project")).toEqual({
      provider: "github",
      owner: "example",
      repo: "project",
      canonicalUrl: "https://github.com/example/project",
    });
  });

  it("rejects non-allowlisted or non-repository URLs", () => {
    expect(() => parsePublicRepositoryUrl("http://github.com/example/project")).toThrow(/https/i);
    expect(() => parsePublicRepositoryUrl("https://evil.example/example/project")).toThrow(/allowlist/i);
    expect(() => parsePublicRepositoryUrl("https://github.com/example/project/issues")).toThrow(/repository/i);
  });

  it("downloads an explicitly requested public repository and records provenance", async () => {
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    const createdResponse = await app.fetch(new Request("https://optimizer.test/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "agent-understanding", windowHours: 6 }) }));
    const created = await json<{ id: string; uploadToken: string }>(createdResponse);
    const archive = zipSync({ "README.md": strToU8("# From GitHub") });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ default_branch: "main" }))
      .mockResolvedValueOnce(new Response(archive, { status: 200, headers: { "content-type": "application/zip" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/import-public-repo`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/example/project" }) }));
      expect(response.status).toBe(201);
      const body = await json<{ source: { repository: string; externalProcessing: boolean }; files: string[] }>(response);
      expect(body.source.repository).toBe("https://github.com/example/project");
      expect(body.source.externalProcessing).toBe(false);
      expect(body.files).toEqual(["project.zip"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects redirects outside the GitHub connector allowlist", async () => {
    const repository = parsePublicRepositoryUrl("https://github.com/example/project");
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/archive.zip" } }));
    await expect(downloadPublicRepository(repository, fetcher)).rejects.toThrow(/unapproved host/i);
  });
});
