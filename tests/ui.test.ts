/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../src/index";
import { renderLandingPage } from "../src/ui";

describe("landing page", () => {
  it("explains the non-technical workflow and retention choices", () => {
    const html = renderLandingPage();
    expect(html).toContain("Drop files here");
    expect(html).toContain("webkitdirectory");
    expect(html).toContain("public GitHub repository");
    expect(html).toContain("1 hour");
    expect(html).toContain("6 hours");
    expect(html).toContain("12 hours");
    expect(html).toContain("no external parser is called");
    expect(html).toContain("navigator.clipboard");
  });
});

describe("landing page theme", () => {
  it("has a light palette and no hard-coded surface colors", () => {
    const html = renderLandingPage();
    expect(html).toContain("prefers-color-scheme: light");
    expect(html).not.toMatch(/background:#101218|background:#202719|dashed #7c869e/);
  });
});

describe("landing page headers", () => {
  it("refuses framing and content sniffing", async () => {
    const response = await worker.fetch(new Request("https://x.test/"), {}, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("deployment logging", () => {
  it("keeps per-request logs and traces off, because share tokens travel in the URL path", () => {
    const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(text) as { observability?: { enabled?: boolean; logs?: { invocation_logs?: boolean }; traces?: { enabled?: boolean } } };
    expect(config.observability?.logs?.invocation_logs).toBe(false);
    expect(config.observability?.traces?.enabled).toBe(false);
    expect(config.observability?.enabled).not.toBe(true);
  });
});
