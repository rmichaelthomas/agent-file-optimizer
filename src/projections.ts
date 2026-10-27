import type { ParsedFile } from "./parsers/types";
import type { ProjectionBundle, SourceFileRecord, StoredObject, WorkspaceRecord } from "./types";

export interface ProjectionSource {
  record: SourceFileRecord;
  parsed: ParsedFile;
}

const encoder = new TextEncoder();

function object(key: string, text: string, contentType = "text/plain; charset=utf-8"): StoredObject {
  return { key, bytes: encoder.encode(text), contentType };
}

function projectionKey(workspaceId: string, name: string): string {
  return `workspaces/${workspaceId}/projections/${name}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function contentMarkdown(sources: ProjectionSource[]): string {
  const sections = ["# Agent-readable content", ""];
  for (const source of sources) {
    sections.push(`## ${source.record.path}`, "", `Parser: \`${source.parsed.parserId}\``, "");
    if (source.parsed.warnings.length > 0) {
      sections.push(...source.parsed.warnings.map((warning) => `> Notice: ${warning}`), "");
    }
    sections.push(source.parsed.text ?? "_No text projection is available. Use the original file._", "");
  }
  return sections.join("\n");
}

function contentJsonl(sources: ProjectionSource[]): string {
  const lines: string[] = [];
  for (const source of sources) {
    if (source.parsed.jsonl.length > 0) {
      for (const line of source.parsed.jsonl) {
        try {
          lines.push(JSON.stringify({ path: source.record.path, data: JSON.parse(line) }));
        } catch {
          lines.push(JSON.stringify({ path: source.record.path, data: line }));
        }
      }
    } else if (source.parsed.text !== null) {
      lines.push(JSON.stringify({ path: source.record.path, text: source.parsed.text }));
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function treeText(workspaceId: string, sources: ProjectionSource[]): string {
  const lines = [`workspaces/${workspaceId}/`, "├── original/"];
  sources.forEach((source, index) => {
    const branch = index === sources.length - 1 ? "└──" : "├──";
    lines.push(`│   ${branch} ${source.record.path}`);
  });
  lines.push("└── projections/", "    ├── content.jsonl", "    ├── content.md", "    ├── handoff.md", "    ├── manifest.json", "    └── tree.txt");
  return `${lines.join("\n")}\n`;
}

function manifest(workspace: WorkspaceRecord, sources: ProjectionSource[]): string {
  const externalProcessing = sources.some(({ parsed }) => parsed.billingClass === "external");
  return `${JSON.stringify(
    {
      version: "0.1",
      workspace: {
        id: workspace.id,
        intent: workspace.intent,
        windowHours: workspace.windowHours,
        createdAt: workspace.createdAt,
        expiresAt: workspace.expiresAt,
        status: workspace.status,
      },
      privacy: {
        retention: "deleted-at-expiry-or-revocation",
        externalProcessing,
        originalsPreserved: true,
      },
      files: sources.map(({ record, parsed }) => ({
        path: record.path,
        contentType: record.contentType,
        bytes: record.bytes,
        size: formatBytes(record.bytes),
        sha256: record.sha256,
        uploadedAt: record.uploadedAt,
        parser: parsed.parserId,
        billingClass: parsed.billingClass,
        confidence: parsed.confidence,
        warnings: parsed.warnings,
        safety: record.safety,
        origin: record.origin,
      })),
      projections: ["handoff.md", "manifest.json", "tree.txt", "content.md", "content.jsonl"],
    },
    null,
    2,
  )}\n`;
}

function handoff(workspace: WorkspaceRecord, sources: ProjectionSource[]): string {
  const unsupported = sources.filter((source) => source.parsed.billingClass === "unsupported").length;
  const externalProcessing = sources.some(({ parsed }) => parsed.billingClass === "external");
  const lines = [
    "# Agent File Optimizer handoff",
    "",
    "This is a temporary workspace prepared for agent use. Its content is deleted when the window ends or the link is revoked.",
    `It was created for **${workspace.intent}** and expires at **${workspace.expiresAt}** (UTC).`,
    "",
    "## Start here",
    "",
    "- Read `manifest.json` for file-level provenance, hashes, parser status, and warnings.",
    "- Read `content.md` for the compact human-readable projection.",
    "- Read `content.jsonl` for row- or record-oriented ingestion.",
    "- Read `tree.txt` to understand the workspace layout.",
    "- Use `original/<path>` when the projection is incomplete or fidelity matters.",
    "",
    `Files: **${sources.length}**`,
    `Formats without a configured native parser: **${unsupported}**`,
    ...(sources.length === 0
      ? [
          "",
          "## No files yet",
          "",
          "Nothing has been uploaded to this workspace, so there is nothing to read yet. If you were expecting files, ask the sender to upload them, then open this link again. The link stays valid until the window ends or the link is revoked.",
        ]
      : []),
    externalProcessing
      ? "External processing was explicitly enabled for at least one file. Review parser provenance, warnings, and any provider charge before relying on the projection."
      : "External processing was not invoked. Unsupported formats are called out rather than silently uploaded to another service.",
    "",
    "## Projections",
    "",
    "- `handoff.md` — this orientation note",
    "- `manifest.json` — machine-readable inventory and provenance",
    "- `tree.txt` — workspace tree",
    "- `content.md` — compact extracted content",
    "- `content.jsonl` — one record per structured row or readable file",
    "",
    "The link is bearer access. Share it only with the intended agent or collaborator.",
    "",
  ];
  return lines.join("\n");
}

export function buildProjectionBundle(workspace: WorkspaceRecord, sources: ProjectionSource[]): ProjectionBundle {
  const sorted = [...sources].sort((left, right) => left.record.path.localeCompare(right.record.path));
  const files = sorted.map(({ record, parsed }) => ({ ...record, parserId: parsed.parserId, billingClass: parsed.billingClass, warnings: [...parsed.warnings] }));
  const values = new Map<string, string>([
    ["content.jsonl", contentJsonl(sorted)],
    ["content.md", contentMarkdown(sorted)],
    ["handoff.md", handoff(workspace, sorted)],
    ["manifest.json", manifest(workspace, sorted)],
    ["tree.txt", treeText(workspace.id, sorted)],
  ]);
  const objects = [...values.entries()].map(([name, text]) =>
    object(projectionKey(workspace.id, name), text, name.endsWith(".json") || name.endsWith(".jsonl") ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8"),
  );
  return { objects, files };
}
