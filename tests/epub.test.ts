import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { readEpub } from "../src/parsers/epub";
import { parseWithBestParser } from "../src/parsers/native";

const CONTAINER = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

function epub(parts: Record<string, string>, extra: Record<string, string> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = { mimetype: strToU8("application/epub+zip") };
  for (const [name, value] of Object.entries({ "META-INF/container.xml": CONTAINER, ...parts, ...extra })) files[name] = strToU8(value);
  return zipSync(files);
}

const xhtml = (body: string): string => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;

const OPF = (spine: string, manifest: string, extra = "", version = "3.0"): string =>
  `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:x</dc:identifier><dc:title>The Lantern Year</dc:title><dc:creator>Ada North</dc:creator><dc:creator>B. Winter</dc:creator><dc:language>en</dc:language><dc:date>2024-03-01</dc:date><dc:subject>Fiction</dc:subject></metadata><manifest>${manifest}</manifest><spine ${extra}>${spine}</spine></package>`;

describe("EPUB reader", () => {
  it("reads in the order the spine sets, with the title, authors and contents the book states", () => {
    const book = epub({
      "OEBPS/content.opf": OPF(
        `<itemref idref="two"/><itemref idref="one"/>`,
        `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="a%20one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>`,
      ),
      "OEBPS/nav.xhtml": xhtml(`<nav epub:type="toc"><ol><li><a href="text/two.xhtml">Part Two</a></li><li><a href="a%20one.xhtml">Part <em>One</em></a><ol><li><a href="a%20one.xhtml#x">Sub</a></li></ol></li></ol></nav>`),
      "OEBPS/a one.xhtml": xhtml(`<h1>One</h1><p>First chapter text.</p>`),
      "OEBPS/text/two.xhtml": xhtml(`<p>Second chapter has no heading of its own.</p>`),
    });
    const result = readEpub(book);
    expect(result.text.startsWith("# The Lantern Year\n\nAuthor: Ada North, B. Winter\nLanguage: en\nPublished: 2024-03-01\nSubjects: Fiction\n\nFormat: EPUB 3.0 · 2 readable sections")).toBe(true);
    expect(result.text).toContain("## Contents\n\n- Part Two\n- Part One\n  - Sub");
    expect(result.text.indexOf("Second chapter")).toBeLessThan(result.text.indexOf("First chapter"));
    expect(result.text).toContain("## Part Two\n\nSecond chapter has no heading of its own.");
    expect(result.text).toContain("## One\n\nFirst chapter text.");
    expect(result.jsonl).toHaveLength(2);
    expect(JSON.parse(result.jsonl[0])).toMatchObject({ section: 1, title: "Part Two" });
    expect(result.warnings).toEqual([]);
  });

  it("names chapters from an NCX when the book has no navigation document", () => {
    const result = readEpub(
      epub({
        "OEBPS/content.opf": OPF(`<itemref idref="c1"/>`, `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>`, 'toc="ncx"', "2.0"),
        "OEBPS/toc.ncx": `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Opening</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>`,
        "OEBPS/c1.xhtml": xhtml(`<p>Just prose.</p>`),
      }),
    );
    expect(result.text).toContain("## Opening\n\nJust prose.");
  });

  it("reads self-closing paragraphs, character references and prefixed MathML in XHTML", () => {
    const result = readEpub(
      epub({
        "OEBPS/content.opf": OPF(`<itemref idref="c"/>`, `<item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>`),
        "OEBPS/c.xhtml": xhtml(`<h2>Heading</h2><p/><p>Fish&nbsp;&amp;&nbsp;chips<br/>next line</p><p>An equation: <m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mi>x</m:mi><m:mo>=</m:mo><m:mn>2</m:mn></m:math></p><p>After.</p>`),
      }),
    );
    expect(result.text).toContain("## Heading\n\nFish & chips\nnext line\n\nAn equation: x=2\n\nAfter.");
  });

  it("opens a book whose fonts are obfuscated but not one whose text is encrypted", () => {
    const parts = {
      "OEBPS/content.opf": OPF(`<itemref idref="c"/>`, `<item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>`),
      "OEBPS/c.xhtml": xhtml(`<p>Readable.</p>`),
    };
    const fonts = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`;
    expect(readEpub(epub(parts, { "META-INF/encryption.xml": fonts })).warnings).toEqual([]);
    const drm = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`;
    expect(readEpub(epub(parts, { "META-INF/encryption.xml": drm })).warnings.join(" ")).toContain("encrypted (DRM)");
  });

  it("says when parts are missing and when the book is only pictures", () => {
    const result = readEpub(
      epub({
        "OEBPS/content.opf": OPF(`<itemref idref="c"/><itemref idref="gone"/>`, `<item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="gone" href="gone.xhtml" media-type="application/xhtml+xml"/>`),
        "OEBPS/c.xhtml": xhtml(`<p>Present.</p>`),
      }),
    );
    expect(result.warnings.join(" ")).toContain("1 part(s) listed in the reading order could not be read");
    expect(() =>
      readEpub(epub({ "OEBPS/content.opf": OPF(`<itemref idref="p"/>`, `<item id="p" href="p.jpg" media-type="image/jpeg"/>`) })),
    ).toThrow(/pictures/);
  });

  it("stops at the size limit and says how much was read", () => {
    const chapter = (n: number): string => xhtml(`<h1>Chapter ${n}</h1>` + `<p>${"word ".repeat(120_000)}</p>`);
    const ids = [1, 2, 3, 4];
    const result = readEpub(
      epub({
        "OEBPS/content.opf": OPF(ids.map((n) => `<itemref idref="c${n}"/>`).join(""), ids.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join("")),
        ...Object.fromEntries(ids.map((n) => [`OEBPS/c${n}.xhtml`, chapter(n)])),
      }),
    );
    expect(result.warnings.join(" ")).toMatch(/2 of 4 sections were read; the last 2 were not/);
    expect(result.text.length).toBeLessThan(1_700_000);
  });

  it("refuses what is not a book", () => {
    expect(() => readEpub(zipSync({ "a.txt": strToU8("hello") }))).toThrow(/no package document/);
    expect(() => readEpub(strToU8("not a zip at all"))).toThrow(/safely inspected/);
  });

  it("is chosen by name or type, and held back when document reading is off", async () => {
    const book = epub({
      "OEBPS/content.opf": OPF(`<itemref idref="c"/>`, `<item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>`),
      "OEBPS/c.xhtml": xhtml(`<p>Chosen.</p>`),
    });
    const byName = await parseWithBestParser({ path: "book.epub", contentType: "application/octet-stream", bytes: book });
    expect(byName.parserId).toBe("native-epub");
    expect(byName.text).toContain("Chosen.");
    const byType = await parseWithBestParser({ path: "download", contentType: "application/epub+zip", bytes: book });
    expect(byType.parserId).toBe("native-epub");
    const off = await parseWithBestParser({ path: "book.epub", contentType: "application/epub+zip", bytes: book }, { allowDocuments: false });
    expect(off.text).toBeNull();
    expect(off.warnings.join(" ")).toContain("DOCUMENT_READING");
  });
});
