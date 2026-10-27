/// <reference types="node" />
// Writes what the reader extracts from every PDF and Office file in a folder, for comparing with other
// extractors (scripts/benchmark/compare_extraction.py). It does nothing unless both variables are set:
//   EVAL_IN=/path/to/files EVAL_OUT=/path/to/output npx vitest run tests/extraction-dump.test.ts
import { it } from "vitest";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseWithBestParser } from "../src/parsers/native";

it("dumps extracted text for comparison", async () => {
  if (!process.env.EVAL_IN || !process.env.EVAL_OUT) return;
  const dir = process.env.EVAL_IN!;
  const out = process.env.EVAL_OUT!;
  mkdirSync(out, { recursive: true });
  const summary: Record<string, unknown> = {};
  for (const name of readdirSync(dir)) {
    if (!/\.(docx|pptx|xlsx|pdf)$/i.test(name)) continue;
    const bytes = new Uint8Array(readFileSync(join(dir, name)));
    const started = performance.now();
    const parsed = await parseWithBestParser({ path: name, contentType: "application/octet-stream", bytes });
    const ms = Math.round(performance.now() - started);
    writeFileSync(join(out, `${name}.txt`), parsed.text ?? "");
    summary[name] = { parser: parsed.parserId, chars: parsed.text?.length ?? 0, warnings: parsed.warnings, ms, confidence: parsed.confidence };
  }
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 1));
});
