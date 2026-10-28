// Bundled and run by capture-samples.mjs. It feeds two small files through the product's own
// parser and projection code and prints what the workspace would contain, as JSON on stdout.
import { createHash } from "node:crypto";
import { parseWithBestParser } from "../../src/parsers/native";
import { buildProjectionBundle } from "../../src/projections";
import type { SourceFileRecord, WorkspaceRecord } from "../../src/types";

const workspace: WorkspaceRecord = {
  id: "00000000-0000-4000-8000-000000000000",
  uploadTokenHash: "sample",
  shareTokenHash: "sample",
  createdAt: "2026-01-01T12:00:00.000Z",
  expiresAt: "2026-01-01T18:00:00.000Z",
  windowHours: 6,
  intent: "agent-understanding",
  status: "ready",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const inputs = [
  { path: "data/people.csv", contentType: "text/csv", text: "name,role\nAda,engineer\nGrace,admiral\n" },
  { path: "docs/note.md", contentType: "text/markdown", text: "# Hello\n\nA note for the agent.\n" },
];

const sources = [];
for (const input of inputs) {
  const bytes = encoder.encode(input.text);
  const parsed = await parseWithBestParser({ path: input.path, contentType: input.contentType, bytes });
  const record: SourceFileRecord = {
    workspaceId: workspace.id,
    path: input.path,
    contentType: input.contentType,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uploadedAt: workspace.createdAt,
    parserId: parsed.parserId,
    billingClass: parsed.billingClass,
    warnings: parsed.warnings,
    safety: { status: "basic-check-passed", scanner: "basic-heuristics-only", signals: [], disclaimer: "This is not a malware verdict. It is a small local heuristic check; enhanced scanning is a separate, explicitly priced path." },
    origin: { kind: "upload" },
  };
  sources.push({ record, parsed });
}

const bundle = buildProjectionBundle(workspace, sources);
const outputs: Record<string, string> = {};
for (const object of bundle.objects) outputs[object.key.split("/").pop() as string] = decoder.decode(object.bytes);

console.log(JSON.stringify({ workspace: { windowHours: workspace.windowHours, intent: workspace.intent }, inputs, outputs }, null, 2));
