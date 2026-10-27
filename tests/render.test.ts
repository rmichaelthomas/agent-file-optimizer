import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { renderMarkdown } from "../src/render";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import { json, memoryEnv } from "./helpers";

describe("markdown rendering for people", () => {
  it("turns bold and code into elements and leaves no raw markers", () => {
    const html = renderMarkdown("It was created for **agent-understanding**; read `manifest.json`.");
    expect(html).toContain("<strong>agent-understanding</strong>");
    expect(html).toContain("<code>manifest.json</code>");
    expect(html).not.toContain("**");
    expect(html).not.toContain("`");
  });

  it("escapes markup that arrives in file content", () => {
    const html = renderMarkdown("# <script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n```\n<b>raw</b>\n```");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
  });

  it("shows an ISO timestamp as a readable UTC time", () => {
    expect(renderMarkdown("expires at **2026-10-27T21:45:00.000Z** (UTC)")).toContain("Tue 27 Oct 2026, 21:45 UTC");
  });
});

describe("share link content negotiation", () => {
  async function workspace() {
    const app = createApp(memoryEnv(), { store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
    const created = await app.fetch(new Request("https://optimizer.test/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }),
    }));
    return { app, ...(await json<{ shareUrl: string }>(created)) };
  }

  it("serves HTML to a browser navigation and Markdown to everything else", async () => {
    const { app, shareUrl } = await workspace();
    const browser = await app.fetch(new Request(shareUrl, { headers: { accept: "text/html,*/*;q=0.8", "sec-fetch-dest": "document" } }));
    expect(browser.headers.get("content-type")).toContain("text/html");
    expect(browser.headers.get("content-security-policy")).not.toContain("script-src");
    expect(await browser.text()).toContain("<h1>Agent File Optimizer handoff</h1>");

    const fetcher = await app.fetch(new Request(shareUrl, { headers: { accept: "text/html,*/*;q=0.8" } }));
    expect(fetcher.headers.get("content-type")).toContain("text/markdown");
    expect(await fetcher.text()).toContain("# Agent File Optimizer handoff");

    const plain = await app.fetch(new Request(`${shareUrl}/handoff.md`, { headers: { accept: "text/html", "sec-fetch-dest": "document" } }));
    expect(plain.headers.get("content-type")).toContain("text/markdown");
  });
});
