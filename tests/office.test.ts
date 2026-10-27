/// <reference types="node" />
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseWithBestParser } from "../src/parsers/native";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const parse = (path: string, bytes: Uint8Array) => parseWithBestParser({ path, contentType: "application/octet-stream", bytes });

// Files from real writers: pandoc for DOCX and PPTX, openpyxl and XlsxWriter for XLSX.
describe("DOCX", () => {
  it("keeps headings, lists, tables, links, footnotes, and accents from a pandoc file", async () => {
    const parsed = await parse("spec.docx", fixture("spec-pandoc.docx"));
    expect(parsed.parserId).toBe("native-office-docx");
    const text = parsed.text ?? "";
    expect(text).toContain("# Overview");
    expect(text).toContain("## Steps");
    expect(text).toContain("1. Pick a window of 1, 6, or 12 hours.");
    expect(text).toContain("  - Folders keep relative paths.");
    expect(text).toContain("| Window | Use for |");
    expect(text).toContain("| 12 hours | Overnight batch |");
    expect(text).toContain("[setup guide](https://example.com/setup)");
    expect(text).toContain("Copy the link[^1].");
    expect(text).toContain("[^1]: The link is a bearer link.");
    expect(text).toContain("Café, naïve, and “quoted” text must survive.");
    expect(text).not.toMatch(/# Ana Reyes/);
  });

  it("reads comments, headers, footers, text boxes, and picture descriptions from a hand-built package", async () => {
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="d" xmlns:a="a" xmlns:mc="m" xmlns:wps="s"';
    const document = `<w:document ${w}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Plan</w:t></w:r></w:p>
      <w:p><w:r><w:t>Before</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>after</w:t></w:r><w:del><w:r><w:delText>removed</w:delText></w:r></w:del><w:ins><w:r><w:t> added</w:t></w:r></w:ins></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" descr="A bar chart of signups"/></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Boxed note</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Boxed note</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>
    </w:body></w:document>`;
    const styles = `<w:styles ${w}><w:style w:styleId="Heading1" w:type="paragraph"><w:name w:val="heading 1"/></w:style></w:styles>`;
    const comments = `<w:comments ${w}><w:comment w:id="0" w:author="Ana"><w:p><w:r><w:t>Check the date</w:t></w:r></w:p></w:comment></w:comments>`;
    const header = `<w:hdr ${w}><w:p><w:r><w:t>Confidential</w:t></w:r></w:p></w:hdr>`;
    const footer = `<w:ftr ${w}><w:p><w:r><w:t>Page footer</w:t></w:r></w:p></w:ftr>`;
    const bytes = zipSync({
      "word/document.xml": strToU8(document),
      "word/styles.xml": strToU8(styles),
      "word/comments.xml": strToU8(comments),
      "word/header1.xml": strToU8(header),
      "word/footer1.xml": strToU8(footer),
    });
    const text = (await parse("plan.docx", bytes)).text ?? "";
    expect(text).toContain("# Plan");
    expect(text).toContain("Before\tafter added");
    expect(text).not.toContain("removed");
    expect(text).toContain("[Image: A bar chart of signups]");
    expect(text.match(/Boxed note/g)).toHaveLength(1);
    expect(text).toContain("## Comments");
    expect(text).toContain("- Ana: Check the date");
    expect(text.indexOf("Header: Confidential")).toBeLessThan(text.indexOf("Footer: Page footer"));
  });

  it("falls back to raw text when the package has no readable document part", async () => {
    const bytes = zipSync({ "word/other.xml": strToU8("<x><w:t>stray text</w:t></x>") });
    const parsed = await parse("odd.docx", bytes);
    expect(parsed.text).toContain("stray text");
    expect(parsed.warnings.join(" ")).toContain("could not be read");
  });
});

describe("PPTX", () => {
  it("reads slides in order with titles, bullets, a table, and speaker notes from a pandoc file", async () => {
    const parsed = await parse("deck.pptx", fixture("deck-pandoc.pptx"));
    expect(parsed.parserId).toBe("native-office-pptx");
    const text = parsed.text ?? "";
    expect(text).toContain("## Slide 2: Results");
    expect(text).toContain("- Signups up 12%");
    expect(text).toContain("  - Enterprise: 1.2%");
    expect(text).toContain("> Notes: Mention pricing first.");
    expect(text).toContain("| Q2 | Scale |");
    expect(text.indexOf("Slide 2")).toBeLessThan(text.indexOf("Slide 3"));
  });

  it("follows the presentation's slide order, not the file names", async () => {
    const slide = (title: string) => `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const bytes = zipSync({
      "ppt/presentation.xml": strToU8('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>'),
      "ppt/_rels/presentation.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="t/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="t/slide" Target="slides/slide2.xml"/></Relationships>'),
      "ppt/slides/slide1.xml": strToU8(slide("Second in the deck")),
      "ppt/slides/slide2.xml": strToU8(slide("First in the deck")),
    });
    const text = (await parse("order.pptx", bytes)).text ?? "";
    expect(text.indexOf("First in the deck")).toBeLessThan(text.indexOf("Second in the deck"));
  });
});

describe("XLSX", () => {
  it("reads sheets, dates, booleans, formulas, and hidden sheets from an openpyxl file", async () => {
    const text = (await parse("sales.xlsx", fixture("sales-openpyxl.xlsx"))).text ?? "";
    expect(text).toContain("### Sheet: Sales");
    expect(text).toContain("Date\tRegion\tUnits\tActive");
    expect(text).toContain("2026-01-05\tEMEA\t12\tTRUE");
    expect(text).toContain("2026-01-06 13:30\tAPAC\t7\tFALSE");
    expect(text).toContain("\tTotal\t=C2+C3");
    expect(text).toContain("### Sheet: Archive (hidden)");
  });

  it("shows dates as dates and formulas as their calculated value from an XlsxWriter file", async () => {
    const text = (await parse("stock.xlsx", fixture("stock-xlsxwriter.xlsx"))).text ?? "";
    expect(text).toContain("Bolt\t0.25\t2026-02-01");
    expect(text).toContain("Total\t12.75");
  });

  it("leaves out rows past the limit and says so", async () => {
    const rows = Array.from({ length: 5200 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join("");
    const bytes = zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="Big" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
    });
    const parsed = await parse("big.xlsx", bytes);
    expect(parsed.warnings.join(" ")).toContain("200 more row(s)");
  });

  it("ignores cells whose column is past Excel's own limit instead of padding to it", async () => {
    const bytes = zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="ZZZZZZZZ1"><v>2</v></c></row></sheetData></worksheet>'),
    });
    const started = Date.now();
    const text = (await parse("wide.xlsx", bytes)).text ?? "";
    expect(Date.now() - started).toBeLessThan(2000);
    expect(text).toContain("1");
    expect(text).not.toContain("\t\t\t\t");
  });
});

describe("hostile structure", () => {
  it("does not blow the stack on a deeply nested DOCX", async () => {
    const depth = 5000;
    const document = `<w:document xmlns:w="w"><w:body><w:p>${"<w:ins>".repeat(depth)}<w:r><w:t>deep</w:t></w:r>${"</w:ins>".repeat(depth)}</w:p></w:body></w:document>`;
    const parsed = await parse("deep.docx", zipSync({ "word/document.xml": strToU8(document) }));
    expect(parsed.parserId).toBe("native-office-docx");
    expect(parsed.warnings.join(" ")).toContain("could not be read");
  });
});

