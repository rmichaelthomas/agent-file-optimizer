import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseWithBestParser } from "../src/parsers/native";

describe("archive and document parser families", () => {
  it("extracts readable files from a ZIP without discarding the original", async () => {
    const bytes = zipSync({
      "src/index.ts": strToU8("export const answer = 42;"),
      "README.md": strToU8("# Example\n\nA small project."),
    });
    const parsed = await parseWithBestParser({ path: "project.zip", contentType: "application/zip", bytes });
    expect(parsed.parserId).toBe("native-archive");
    expect(parsed.billingClass).toBe("free-native");
    expect(parsed.text).toContain("src/index.ts");
    expect(parsed.text).toContain("answer = 42");
    expect(parsed.jsonl.some((line) => line.includes("src/index.ts"))).toBe(true);
  });

  it("extracts text from a simple DOCX package", async () => {
    const bytes = zipSync({
      "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>Hello from DOCX</w:t></w:r></w:p></w:body></w:document>"),
    });
    const parsed = await parseWithBestParser({ path: "brief.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes });
    expect(parsed.parserId).toBe("native-office-docx");
    expect(parsed.text).toContain("Hello from DOCX");
  });

  it("extracts basic literal text from an uncompressed PDF", async () => {
    const pdf = "%PDF-1.4\n1 0 obj\n<<>>\nstream\n(Basic PDF text) Tj\nendstream\nendobj\n%%EOF";
    const parsed = await parseWithBestParser({ path: "brief.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode(pdf) });
    expect(parsed.parserId).toBe("native-pdf-basic");
    expect(parsed.text).toContain("Basic PDF text");
  });
});
