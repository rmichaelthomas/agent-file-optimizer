import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import { json, memoryEnv } from "./helpers";
import { classifyRepositoryPath, downloadPublicRepository, parsePublicRepositoryUrl, scanRepository, selectRepositoryFiles } from "../src/repository";

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

  const repoArchive = () => zipSync({
    "project-main/README.md": strToU8("# From GitHub"),
    "project-main/AGENTS.md": strToU8("Use npm test."),
    "project-main/CLAUDE.md": strToU8("Tool specific."),
    "project-main/llms.txt": strToU8("# Project"),
    "project-main/package.json": strToU8("{}"),
    "project-main/docs/guide.md": strToU8("# Guide"),
    "project-main/docs/agents/overview.md": strToU8("# For agents"),
    "project-main/.env": strToU8("SECRET=1"),
    "project-main/src/index.ts": strToU8("export const secret = 1;"),
    "project-main/node_modules/x/README.md": strToU8("vendored"),
    "project-main/assets/logo.png": new Uint8Array([1, 2, 3]),
  });

  async function newWorkspace(app: ReturnType<typeof createApp>) {
    const createdResponse = await app.fetch(new Request("https://optimizer.test/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "agent-understanding", windowHours: 6 }) }));
    return json<{ id: string; uploadToken: string; shareUrl: string }>(createdResponse);
  }

  function stubGitHub(archive: BodyInit, times = 1) {
    const fetchMock = vi.fn();
    for (let index = 0; index < times; index += 1) fetchMock.mockResolvedValueOnce(Response.json({ default_branch: "main" })).mockResolvedValueOnce(new Response(archive, { status: 200, headers: { "content-type": "application/zip" } }));
    vi.stubGlobal("fetch", fetchMock);
  }

  it("previews what a repository offers, grouped and with defaults, and stores nothing", async () => {
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    stubGitHub(repoArchive());
    try {
      const response = await app.fetch(new Request("https://optimizer.test/api/preview-public-repo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/example/project" }) }));
      expect(response.status).toBe(200);
      const body = await json<{ branch: string; files: Array<{ path: string; group: string; checked: boolean }> }>(response);
      const byPath = Object.fromEntries(body.files.map((file) => [file.path, file]));
      expect(Object.keys(byPath).sort()).toEqual(["AGENTS.md", "CLAUDE.md", "README.md", "docs/agents/overview.md", "docs/guide.md", "llms.txt", "package.json"]);
      expect(byPath["AGENTS.md"]).toMatchObject({ group: "agent", checked: true });
      expect(byPath["README.md"]).toMatchObject({ group: "orientation", checked: true });
      expect(byPath["package.json"]).toMatchObject({ group: "manifest", checked: true });
      expect(byPath["CLAUDE.md"]).toMatchObject({ group: "tool", checked: false });
      expect(byPath["docs/guide.md"]).toMatchObject({ group: "docs", checked: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires the admin token to preview when one is set", async () => {
    const app = createApp({ ...memoryEnv(), ADMIN_TOKEN: "a-long-random-value" }, { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    const response = await app.fetch(new Request("https://optimizer.test/api/preview-public-repo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/example/project" }) }));
    expect(response.status).toBe(401);
  });

  it("imports exactly the chosen files plus a names-only file list, and labels them as repository content", async () => {
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    const created = await newWorkspace(app);
    stubGitHub(repoArchive());
    try {
      const response = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/import-public-repo`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/example/project", paths: ["README.md", "CLAUDE.md"] }) }));
      expect(response.status).toBe(201);
      const body = await json<{ source: { repository: string; externalProcessing: boolean }; files: string[] }>(response);
      expect(body.source.repository).toBe("https://github.com/example/project");
      expect(body.source.externalProcessing).toBe(false);
      expect(body.files).toEqual(["CLAUDE.md", "README.md", "repository-files.txt"]);
      const list = await (await app.fetch(new Request(`${created.shareUrl}/original/repository-files.txt`))).text();
      expect(list).toContain("src/index.ts");
      expect(list).not.toContain("node_modules");
      expect(list).not.toContain("export const secret");
      const handoff = await (await app.fetch(new Request(created.shareUrl))).text();
      expect(handoff).toContain("came from a public repository");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("takes the default selection when no paths are sent", async () => {
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    const created = await newWorkspace(app);
    stubGitHub(repoArchive());
    try {
      const response = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/import-public-repo`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/example/project", includeFileList: false }) }));
      const body = await json<{ files: string[] }>(response);
      expect(body.files).toEqual(["AGENTS.md", "llms.txt", "package.json", "README.md", "docs/agents/overview.md"].sort((a, b) => a.localeCompare(b)));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a path the preview never offered", async () => {
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    const created = await newWorkspace(app);
    stubGitHub(repoArchive());
    try {
      for (const path of [".env", "src/index.ts", "node_modules/x/README.md"]) {
        stubGitHub(repoArchive());
        const response = await app.fetch(new Request(`https://optimizer.test/api/workspaces/${created.id}/import-public-repo`, { method: "POST", headers: { authorization: `Bearer ${created.uploadToken}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/example/project", paths: [path] }) }));
        expect(response.status, path).toBe(400);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects redirects outside the GitHub connector allowlist", async () => {
    const repository = parsePublicRepositoryUrl("https://github.com/example/project");
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/archive.zip" } }));
    await expect(downloadPublicRepository(repository, fetcher)).rejects.toThrow(/unapproved host/i);
  });

  it("classifies paths and never offers secrets, vendored code, or source", () => {
    expect(classifyRepositoryPath("llms-full.txt")).toBe("agent");
    expect(classifyRepositoryPath("packages/a/AGENTS.md")).toBe("agent");
    expect(classifyRepositoryPath(".cursor/rules/style.mdc")).toBe("tool");
    expect(classifyRepositoryPath(".github/copilot-instructions.md")).toBe("tool");
    expect(classifyRepositoryPath("docs/api/intro.md")).toBe("docs");
    for (const path of [".env", ".env.production", "docs/key.pem", "src/index.ts", "lib/notes.md", "node_modules/a/README.md", "docs/agents/.hidden.md", "docs/logo.png", ".claude/settings.json", "yarn.lock"]) expect(classifyRepositoryPath(path), path).toBeNull();
  });

  it("drops the archive wrapper folder and lists the rest by name only", () => {
    const archive = zipSync({ "p-main/llms.txt": strToU8("hi"), "p-main/src/a.ts": strToU8("x"), "p-main/node_modules/z/i.js": strToU8("y") });
    const scan = scanRepository(archive);
    expect(selectRepositoryFiles(archive, scan).map((file) => file.path)).toEqual(["llms.txt"]);
    expect(scan.total).toBe(3);
    expect(scan.treePaths).toEqual(["llms.txt", "src/a.ts"]);
  });
});
