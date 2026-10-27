/// <reference types="node" />
import { readFileSync } from "node:fs";
import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cffEncoding, type1Encoding } from "../src/parsers/fontprogram";
import { CFF_STANDARD_STRINGS } from "../src/parsers/glyphs";
import { parseWithBestParser } from "../src/parsers/native";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const parse = (bytes: Uint8Array) => parseWithBestParser({ path: "test.pdf", contentType: "application/pdf", bytes });
const bytesOf = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 255);

type PdfObject = string | { dict: string; data: Uint8Array };

/** Assembles a small PDF from object bodies: object N is the Nth entry. */
function buildPdf(objects: PdfObject[], trailer = "/Root 1 0 R"): Uint8Array {
  const parts: Uint8Array[] = [bytesOf("%PDF-1.5\n")];
  objects.forEach((object, index) => {
    if (typeof object === "string") parts.push(bytesOf(`${index + 1} 0 obj\n${object}\nendobj\n`));
    else parts.push(bytesOf(`${index + 1} 0 obj\n<<${object.dict} /Length ${object.data.length}>>\nstream\n`), object.data, bytesOf("\nendstream\nendobj\n"));
  });
  parts.push(bytesOf(`trailer\n<< ${trailer} >>\n%%EOF\n`));
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const content = (text: string): PdfObject => ({ dict: "", data: bytesOf(text) });

/** One page whose Resources and Contents are given; extra objects start at number 5. */
function onePage(stream: string, resources: string, extra: PdfObject[] = []): Uint8Array {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << ${resources} >> >>`,
    content(stream),
    ...extra,
  ]);
}

describe("PDFs from real writers", () => {
  it("reads a Chrome PDF (compressed object streams, composite font with a character map)", async () => {
    const parsed = await parse(fixture("notes-chrome.pdf"));
    expect(parsed.parserId).toBe("native-pdf");
    expect(parsed.text).toContain("Meeting notes");
    expect(parsed.text).toContain("Owner: Ana (ana@example.com)");
    expect(parsed.text).toContain("Budget: $4,200 — approved.");
    expect(parsed.confidence).toBe("high");
  });

  it("reads a macOS (Quartz) PDF", async () => {
    const text = (await parse(fixture("notes-quartz.pdf"))).text ?? "";
    expect(text).toContain("Decided: ship Friday.");
    expect(text).toContain("Budget: $4,200 — approved.");
  });

  it("reads a ReportLab PDF with two pages, accents, and its title", async () => {
    const parsed = await parse(fixture("report-reportlab.pdf"));
    const text = parsed.text ?? "";
    expect(text).toContain("Title: Quarterly report");
    expect(text).toContain("### Page 1");
    expect(text).toContain("### Page 2");
    expect(text).toContain("Revenue grew 12% year over year, driven by the new self-serve plan.");
    expect(text).toContain("café, naïve, résumé — “quoted”");
    expect(text).not.toContain("Author: anonymous");
    expect(parsed.jsonl).toHaveLength(2);
  });
});

describe("text layout", () => {
  const font = "/Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >>";

  it("puts a space where the writer left a gap, and none where it only kerned", async () => {
    const pdf = onePage("BT /F1 10 Tf 50 700 Td [(Hel) 20 (lo) -300 (wor) 15 (ld)] TJ ET", font);
    expect((await parse(pdf)).text).toBe("Hello world");
  });

  it("starts a new line when the baseline moves and a new paragraph for a big gap", async () => {
    const pdf = onePage("BT /F1 10 Tf 50 700 Td (First line) Tj 0 -12 Td (Second line) Tj 0 -12 Td (Third line) Tj 0 -40 Td (After a gap) Tj ET", font);
    expect((await parse(pdf)).text).toBe("First line\nSecond line\nThird line\n\nAfter a gap");
  });

  it("joins words drawn as separate pieces on one line", async () => {
    const pdf = onePage("BT /F1 10 Tf 1 0 0 1 50 700 Tm (Alpha) Tj 1 0 0 1 90 700 Tm (Beta) Tj ET", font);
    expect((await parse(pdf)).text).toBe("Alpha Beta");
  });

  it("reads text inside a form XObject", async () => {
    const form: PdfObject = { dict: "/Type /XObject /Subtype /Form /BBox [0 0 100 100]", data: bytesOf("BT /F1 10 Tf 5 5 Td (Inside the form) Tj ET") };
    const pdf = onePage("q 1 0 0 1 0 0 cm /Fm1 Do Q", `${font} /XObject << /Fm1 5 0 R >>`, [form]);
    expect((await parse(pdf)).text).toBe("Inside the form");
  });

  it("includes invisible text, which is how scanned pages carry their recognized text", async () => {
    const pdf = onePage("BT /F1 12 Tf 3 Tr 20 100 Td (Recognized words) Tj ET", font);
    expect((await parse(pdf)).text).toBe("Recognized words");
  });

  it("skips an inline image without reading its bytes as text", async () => {
    const pdf = onePage("BT /F1 10 Tf 50 700 Td (Before) Tj ET q 10 0 0 10 0 0 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \x00\x01(Fake) Tj\x02\x03 EI Q BT /F1 10 Tf 50 650 Td (After) Tj ET", font);
    expect((await parse(pdf)).text).toBe("Before\nAfter");
  });
});

describe("fonts and encodings", () => {
  it("decodes a composite font through its ToUnicode map (ranges, single codes, ligatures)", async () => {
    const cmap = [
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
      "1 begincodespacerange <0000> <FFFF> endcodespacerange",
      "1 beginbfrange <0001> <0003> <0048> endbfrange",
      "2 beginbfchar <0004> <0020> <0005> <00660069> endbfchar",
      "endcmap",
    ].join("\n");
    const font = "<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>] /ToUnicode 6 0 R >>";
    const pdf = onePage("BT /F1 10 Tf 50 700 Td <0001000200030004000500010005> Tj ET", "/Font << /F1 5 0 R >>", [font, content(cmap)]);
    expect((await parse(pdf)).text).toBe("HIJ fiHfi");
  });

  it("uses Differences and glyph names, including ligatures and accents", async () => {
    const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [128 /fi /fl 130 /eacute /uni00DF] >> >>";
    const pdf = onePage("BT /F1 10 Tf 50 700 Td (de\\200ne \\201oor caf\\202 \\203) Tj ET", "/Font << /F1 5 0 R >>", [font]);
    expect((await parse(pdf)).text).toBe("define floor café ß");
  });

  it("maps codes through a font program's built-in encoding when the PDF names none", async () => {
    // A tiny CFF font whose own encoding puts the "fi" ligature on code 140.
    const glyphs = ["d", "e", "fi", "n"];
    const codes = [100, 101, 140, 110];
    const sid = (name: string) => CFF_STANDARD_STRINGS.indexOf(name);
    const index = (items: number[][]): number[] => {
      if (items.length === 0) return [0, 0];
      const offsets = [1];
      for (const item of items) offsets.push(offsets[offsets.length - 1] + item.length);
      return [0, items.length, 1, ...offsets, ...items.flat()];
    };
    const header = [1, 0, 4, 1];
    const names = index([[84]]);
    const topSize = 18;
    const topLength = index([new Array(topSize).fill(0)]).length;
    const stringIndex = [0, 0];
    const subrs = [0, 0];
    const base = header.length + names.length + topLength + stringIndex.length + subrs.length;
    const charset = [0, ...glyphs.flatMap((name) => [sid(name) >> 8, sid(name) & 255])];
    const encoding = [0, codes.length, ...codes];
    const charsetAt = base;
    const encodingAt = charsetAt + charset.length;
    const charStringsAt = encodingAt + encoding.length;
    const int5 = (value: number) => [29, (value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255];
    const top = [...int5(charsetAt), 15, ...int5(encodingAt), 16, ...int5(charStringsAt), 17];
    const charStrings = index([[14], [14], [14], [14], [14]]);
    const cff = Uint8Array.from([...header, ...names, ...index([top]), ...stringIndex, ...subrs, ...charset, ...encoding, ...charStrings]);

    const map = cffEncoding(cff);
    expect(map).toBeInstanceOf(Map);
    expect((map as Map<number, string>).get(140)).toBe("fi");

    const widths = new Array(42).fill(500).join(" ");
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      content("BT /F1 10 Tf 50 700 Td (de\\214ne) Tj ET"),
      `<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Test /FirstChar 100 /LastChar 141 /Widths [${widths}] /FontDescriptor 6 0 R >>`,
      "<< /Type /FontDescriptor /FontName /ABCDEF+Test /Flags 4 /FontFile3 7 0 R >>",
      { dict: "/Subtype /Type1C", data: cff },
    ]);
    expect((await parse(pdf)).text).toBe("define");
  });

  it("reads a Type 1 font's built-in encoding from its clear-text header", () => {
    const header = bytesOf("%!PS-AdobeFont-1.0: Test\n/Encoding 256 array\n0 1 255 {1 index exch /.notdef put} for\ndup 140 /fi put\ndup 141 /fl put\nreadonly def\ncurrentfile eexec\n\x00\x01dup 7 /bad put");
    const map = type1Encoding(header);
    expect(map).toBeInstanceOf(Map);
    expect((map as Map<number, string>).get(141)).toBe("fl");
    expect((map as Map<number, string>).has(7)).toBe(false);
    expect(type1Encoding(bytesOf("/Encoding StandardEncoding def\ncurrentfile eexec"))).toBe("standard");
  });
});

describe("files it cannot or should not read", () => {
  it("says so for an encrypted PDF and returns no text", async () => {
    const pdf = buildPdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>", "<< /Filter /Standard /V 1 >>"], "/Root 1 0 R /Encrypt 3 0 R");
    const parsed = await parse(pdf);
    expect(parsed.text).toBeNull();
    expect(parsed.warnings.join(" ")).toContain("encrypted");
  });

  it("says a page of only an image looks scanned", async () => {
    const image: PdfObject = { dict: "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", data: new Uint8Array([255]) };
    const pdf = onePage("q 100 0 0 100 0 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image]);
    const parsed = await parse(pdf);
    expect(parsed.text).toBeNull();
    expect(parsed.warnings.join(" ")).toContain("scanned");
  });

  it("flags a font with no character map instead of printing wrong text", async () => {
    const font = "<< /Type /Font /Subtype /Type0 /BaseFont /Mystery /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 >>] >>";
    const pdf = onePage("BT /F1 10 Tf 50 700 Td <00010002> Tj ET", "/Font << /F1 5 0 R >>", [font]);
    const parsed = await parse(pdf);
    expect(parsed.text ?? "").not.toMatch(/[A-Za-z]/);
    expect(parsed.warnings.join(" ")).toContain("cannot decode");
  });

  it("does not expand a compressed stream past its limit", async () => {
    const bomb = zlibSync(new Uint8Array(40 * 1024 * 1024));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << >> >>",
      { dict: "/Filter /FlateDecode", data: bomb },
    ]);
    expect(bomb.length).toBeLessThan(200 * 1024);
    const parsed = await parse(pdf);
    expect(parsed.text).toBeNull();
    expect(parsed.warnings.join(" ")).toMatch(/larger than this reader/);
  });

  it("returns a warning, not an error, for garbage and for a truncated file", async () => {
    const noise = Uint8Array.from({ length: 4000 }, (_, i) => (i * 7919 + 13) & 255);
    expect((await parse(noise)).text).toBeNull();
    const whole = fixture("notes-chrome.pdf");
    const cut = await parse(whole.subarray(0, Math.floor(whole.length / 2)));
    expect(Array.isArray(cut.warnings)).toBe(true);
  });

  it("stops at the page limit and says so", async () => {
    const kids = Array.from({ length: 450 }, (_, i) => `${i + 5} 0 R`).join(" ");
    const pages = Array.from({ length: 450 }, () => "<< /Type /Page /Parent 2 0 R /Resources << >> >>");
    const pdf = buildPdf(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count 450 >>`, "<< >>", "<< >>", ...pages]);
    const parsed = await parse(pdf);
    expect(parsed.warnings.join(" ")).toContain("first 400 of 450 pages");
  });

  it("is not slowed down by a file made of digits", async () => {
    const noise = bytesOf("%PDF-1.4\n" + "1".repeat(3_000_000) + " 0 " + "9 ".repeat(200_000));
    const started = Date.now();
    const parsed = await parse(noise);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(parsed.text).toBeNull();
  });
});

