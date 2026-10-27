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

  it("does not inflate past the declared size when an entry lies about it", async () => {
    // A 60 MB member of zeros whose headers claim 1 KB. The parser must not expand it past the claim.
    const bytes = zipSync({ "bomb.txt": new Uint8Array(60 * 1024 * 1024) });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < bytes.length - 4; offset += 1) {
      const signature = view.getUint32(offset, true);
      if (signature === 0x04034b50) view.setUint32(offset + 22, 1024, true);
      if (signature === 0x02014b50) view.setUint32(offset + 24, 1024, true);
    }
    expect(bytes.length).toBeLessThan(200 * 1024);
    const parsed = await parseWithBestParser({ path: "bomb.zip", contentType: "application/zip", bytes });
    expect(JSON.stringify(parsed).length).toBeLessThan(1024 * 1024);
  });

  it("reads an XLSX as named sheets with tab-separated cells, resolving shared strings", async () => {
    const bytes = zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="x"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/><sheet name="Q&amp;A" sheetId="2" r:id="rId2"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8('<sst><si><t>item</t></si><si><t>qty</t></si><si><t>widget</t></si><si><r><t>gad</t></r><r><t>get</t></r></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="b"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>9</v></c></row></sheetData></worksheet>'),
      "xl/worksheets/sheet2.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>why</t></is></c></row></sheetData></worksheet>'),
    });
    const parsed = await parseWithBestParser({ path: "orders.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes });
    expect(parsed.parserId).toBe("native-office-xlsx");
    expect(parsed.text).toContain("### Sheet: Orders");
    expect(parsed.text).toContain("item\tqty\t\tTRUE");
    expect(parsed.text).toContain("widget\t4");
    expect(parsed.text).toContain("gadget\t9");
    expect(parsed.text).toContain("### Sheet: Q&A");
    expect(parsed.text).toContain("why");
  });
});

