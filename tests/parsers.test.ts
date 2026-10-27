import { describe, expect, it } from "vitest";
import { parseWithBestParser } from "../src/parsers/native";
import type { ExternalParserRunner } from "../src/parsers/types";
import { buildProjectionBundle } from "../src/projections";
import type { SourceFileRecord, WorkspaceRecord } from "../src/types";

const workspace: WorkspaceRecord = {
  id: "w-test",
  uploadTokenHash: "hidden",
  shareTokenHash: "hidden",
  createdAt: "2026-09-13T00:00:00.000Z",
  expiresAt: "2026-09-13T06:00:00.000Z",
  windowHours: 6,
  intent: "agent-understanding",
  status: "ready",
};

function source(path: string, contentType: string, bytes: Uint8Array, parsed: Awaited<ReturnType<typeof parseWithBestParser>>) {
  const record: SourceFileRecord = {
    workspaceId: workspace.id,
    path,
    contentType,
    bytes: bytes.byteLength,
    sha256: "hash",
    uploadedAt: workspace.createdAt,
    parserId: parsed.parserId,
    billingClass: parsed.billingClass,
    warnings: parsed.warnings,
    safety: { status: "basic-check-passed", scanner: "basic-heuristics-only", signals: [], disclaimer: "This is not a malware verdict." },
    origin: { kind: "upload" },
  };
  return { record, parsed };
}

describe("native parser registry", () => {
  it("normalizes JSON and emits a JSONL record", async () => {
    const parsed = await parseWithBestParser({
      path: "data.json",
      contentType: "application/json",
      bytes: new TextEncoder().encode('{"ok":true,"count":2}'),
    });
    expect(parsed.parserId).toBe("native-json");
    expect(parsed.billingClass).toBe("free-native");
    expect(parsed.jsonl).toEqual(['{"ok":true,"count":2}']);
  });

  it("handles quoted CSV cells", async () => {
    const parsed = await parseWithBestParser({
      path: "people.csv",
      contentType: "text/csv",
      bytes: new TextEncoder().encode('name,note\n"Ada, Lovelace","first\nprogrammer"\n'),
    });
    expect(parsed.parserId).toBe("native-table");
    expect(parsed.text).toContain("Ada, Lovelace");
    expect(parsed.jsonl[0]).toContain('"Ada, Lovelace"');
  });

  it("removes executable HTML noise", async () => {
    const parsed = await parseWithBestParser({
      path: "page.html",
      contentType: "text/html",
      bytes: new TextEncoder().encode("<h1>Hello</h1><script>bad()</script><p>World</p>"),
    });
    expect(parsed.parserId).toBe("native-html");
    expect(parsed.text).toBe("Hello\nWorld");
    expect(parsed.text).not.toContain("bad");
  });

  it("preserves malformed JSON as readable text with a warning", async () => {
    const parsed = await parseWithBestParser({
      path: "broken.json",
      contentType: "application/json",
      bytes: new TextEncoder().encode('{"missing":'),
    });
    expect(parsed.parserId).toBe("native-json");
    expect(parsed.confidence).toBe("low");
    expect(parsed.text).toContain("missing");
    expect(parsed.warnings[0]).toMatch(/could not parse/i);
  });

  it("does not pretend unsupported formats were parsed", async () => {
    const parsed = await parseWithBestParser({
      path: "scan.png",
      contentType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(parsed.parserId).toBe("fallback-original-only");
    expect(parsed.billingClass).toBe("unsupported");
    expect(parsed.text).toBeNull();
    expect(parsed.warnings[0]).toMatch(/no parser/i);
  });

  it("uses an external runner only when explicitly enabled", async () => {
    const runner: ExternalParserRunner = {
      id: "test-external",
      billingClass: "external",
      supports: ({ path }) => path.endsWith(".pdf"),
      parse: async () => ({ parserId: "test-external", billingClass: "external", confidence: "medium", text: "External text", jsonl: [], warnings: ["priced runner"] }),
    };
    const input = { path: "brief.pdf", contentType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    expect((await parseWithBestParser(input, { externalRunner: runner })).parserId).toBe("native-pdf-basic");
    const parsed = await parseWithBestParser(input, { allowExternal: true, externalRunner: runner });
    expect(parsed.parserId).toBe("test-external");
    expect(parsed.billingClass).toBe("external");
  });

  it("builds deterministic agent projections with provenance", async () => {
    const bytes = new TextEncoder().encode("# Hello\n\nWorld");
    const parsed = await parseWithBestParser({ path: "README.md", contentType: "text/markdown", bytes });
    const bundle = buildProjectionBundle(workspace, [source("README.md", "text/markdown", bytes, parsed)]);
    const keys = bundle.objects.map((object) => object.key);
    expect(keys).toEqual([
      "workspaces/w-test/projections/content.jsonl",
      "workspaces/w-test/projections/content.md",
      "workspaces/w-test/projections/handoff.md",
      "workspaces/w-test/projections/manifest.json",
      "workspaces/w-test/projections/tree.txt",
    ]);
    const manifest = bundle.objects.find((object) => object.key.endsWith("manifest.json"));
    expect(new TextDecoder().decode(manifest?.bytes)).toContain("native-text");
    expect(new TextDecoder().decode(bundle.objects[2].bytes)).toContain("expires");
  });

  it("records explicit external processing in the handoff", () => {
    const parsed = { parserId: "priced-runner", billingClass: "external" as const, confidence: "medium" as const, text: "Extracted", jsonl: [], warnings: ["External parser was explicitly enabled."] };
    const bundle = buildProjectionBundle(workspace, [source("brief.pdf", "application/pdf", new Uint8Array([1]), parsed)]);
    const manifest = new TextDecoder().decode(bundle.objects.find((object) => object.key.endsWith("manifest.json"))?.bytes);
    const handoff = new TextDecoder().decode(bundle.objects.find((object) => object.key.endsWith("handoff.md"))?.bytes);
    expect(manifest).toContain('"externalProcessing": true');
    expect(handoff).toMatch(/explicitly enabled/i);
  });
});

describe("code and unlisted text files", () => {
  const parse = (path: string, bytes: Uint8Array, contentType = "application/octet-stream") => parseWithBestParser({ path, contentType, bytes });

  it("reads common code extensions as text", async () => {
    for (const path of ["tool.mjs", "main.py", "server.go", "lib.rs", "build.sh", "config.toml"]) {
      const parsed = await parse(path, new TextEncoder().encode("print('hello')\n"));
      expect(parsed.parserId, path).toBe("native-text");
      expect(parsed.text, path).toContain("hello");
    }
  });

  it("reads an unlisted extension as text when the bytes are UTF-8 with no NUL", async () => {
    const parsed = await parse("schema.proto", new TextEncoder().encode('syntax = "proto3";\n'));
    expect(parsed.parserId).toBe("native-text");
    expect(parsed.text).toContain("proto3");
  });

  it("keeps binary and invalid UTF-8 as original-only", async () => {
    expect((await parse("blob.bin", new Uint8Array([0x89, 0x50, 0x00, 0x01, 0x02]))).parserId).toBe("fallback-original-only");
    expect((await parse("broken.dat", new Uint8Array([0xff, 0xfe, 0xfa, 0x41]))).parserId).toBe("fallback-original-only");
  });
});

