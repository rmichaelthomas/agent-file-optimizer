import { describe, expect, it } from "vitest";
import { readHtml, readHtmlString } from "../src/parsers/html";
import { decodeMarkup } from "../src/parsers/markupencoding";

const read = (html: string): string => readHtmlString(html).text;
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("HTML reader", () => {
  it("reads structure: headings, lists, quotes, code, rules", () => {
    const text = read(`<h2>Plan</h2><p>Do <b>this</b> and <i>that</i>.</p><ol start="3"><li>three<li>four<ul><li>nested</ul></ol><blockquote><p>quoted</p></blockquote><pre><code class="language-ts">let a = 1;\n  let b = 2;</code></pre><hr>`);
    expect(text).toContain("## Plan");
    expect(text).toContain("Do **this** and *that*.");
    expect(text).toContain("3. three\n4. four\n   - nested");
    expect(text).toContain("> quoted");
    expect(text).toContain("```ts\nlet a = 1;\n  let b = 2;\n```");
    expect(text).toContain("---");
  });

  it("closes the elements an implied end tag closes", () => {
    expect(read("<p>one<p>two<ul><li>a<li>b</ul>")).toBe("one\n\ntwo\n\n- a\n- b");
    expect(read("<dl><dt>Term<dd>Meaning<dt>Other<dd>More</dl>")).toBe("Term\n: Meaning\nOther\n: More");
  });

  it("does not read what is hidden, scripted or styled", () => {
    const text = read(`<p>shown</p><p hidden>a</p><p aria-hidden="true">b</p><p style="display: none">c</p><script>d()</script><style>.e{}</style><template><p>f</p></template><noscript>g</noscript><input type="hidden" value="h">`);
    expect(text).toBe("shown");
  });

  it("keeps text a screen reader would read even when it is visually hidden", () => {
    expect(read(`<a href="/x"><span class="sr-only">Read the policy</span></a>`)).toBe("[Read the policy](/x)");
  });

  it("writes links, image descriptions and line breaks as the page meant them", () => {
    const text = read(`<p>See <a href="https://example.com/a">the page</a> or <a href="#top">top</a>.<br>Next line <img src="x.png" alt="A chart of sales"><img src="d.png" alt=""></p>`);
    expect(text).toBe("See [the page](https://example.com/a) or top.\nNext line [image: A chart of sales]");
  });

  it("refuses links that run code", () => {
    expect(read(`<a href="javascript:alert(1)">click</a>`)).toBe("click");
  });

  it("reads tables with a header row as tables and other tables as rows", () => {
    expect(read(`<table><caption>Sales</caption><tr><th>Q<th>Total<tr><td>1<td>10</table>`)).toBe("Table: Sales\n\n| Q | Total |\n| --- | --- |\n| 1 | 10 |");
    expect(read(`<table><tr><td>Born<td>1685<tr><td>Died<td>1750</table>`)).toBe("Born | 1685\nDied | 1750");
  });

  it("reads a table used for layout as its content", () => {
    expect(read(`<table><tr><td><p>One</p><td><p>Two</p></table>`)).toBe("One\n\nTwo");
  });

  it("reads what the page declares, only the parts it declares", () => {
    const text = read(`<html lang="fr"><head><title>Le titre</title><meta name="description" content="Un résumé."><link rel="canonical" href="https://example.org/a"><script type="application/ld+json">{"@type":"Article","author":{"name":"Ada"},"datePublished":"2026-01-02"}</script></head><body><p>Texte</p></body></html>`);
    expect(text).toBe("# Le titre\n\nLanguage: fr\nAddress: https://example.org/a\nDescription: Un résumé.\nType: Article\nPublished: 2026-01-02\nAuthor: Ada\n\nTexte");
  });

  it("writes same-site links without the origin the page states", () => {
    const text = read(`<head><link rel="canonical" href="https://example.org/a"></head><p><a href="https://example.org/b">B</a> <a href="https://other.example/c">C</a></p>`);
    expect(text).toContain("[B](/b) [C](https://other.example/c)");
  });

  it("puts a believed <main> first and the rest after", () => {
    const prose = "A sentence of real prose. ".repeat(20);
    const text = read(`<header><a href="/">Home</a></header><main><h1>Story</h1><p>${prose}</p></main><footer><a href="/p">Privacy</a> <a href="/t">Terms</a></footer>`);
    expect(text.indexOf("Story")).toBeLessThan(text.indexOf("Home"));
    expect(text).toContain("Outside the main content:");
    expect(text).toContain("Footer links: Privacy · Terms");
  });

  it("does not believe a <main> that holds a sliver of the page", () => {
    const prose = "Real prose of the page. ".repeat(30);
    const text = read(`<main><p>Search</p></main><article><p>${prose}</p></article>`);
    expect(text).not.toContain("Outside the main content");
    expect(text).toContain("Real prose");
  });

  it("says when a page builds itself with scripts", () => {
    const result = readHtmlString(`<div id="root"></div><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script>`);
    expect(result.warnings.join(" ")).toContain("build its content with scripts");
  });

  it("decodes character references, including the legacy ones without a semicolon", () => {
    expect(read("<p>Fish &amp; chips &copy 2026 &mdash; &#x263a; &#128512; &notit; &bogus;</p>")).toBe("Fish & chips © 2026 — ☺ 😀 ¬it; &bogus;");
  });

  it("follows the page's declared encoding, and falls back honestly", () => {
    const latin = Uint8Array.from([...bytes('<meta charset="iso-8859-1"><p>caf'), 0xe9, ...bytes("</p>")]);
    expect(readHtml(latin).text).toContain("café");
    const guess = Uint8Array.from([...bytes("<p>caf"), 0xe9, ...bytes("</p>")]);
    const result = readHtml(guess);
    expect(result.text).toContain("café");
    expect(result.warnings.join(" ")).toContain("windows-1252");
    expect(decodeMarkup(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes("<p>ok</p>")])).source).toBe("bom");
    expect(readHtml(bytes("<p>日本語</p>")).text).toBe("日本語");
  });

  it("stays linear on hostile markup", () => {
    const started = performance.now();
    read("<div>".repeat(100_000) + "x");
    read("<a ".repeat(100_000));
    read("<!--".repeat(100_000));
    read("&".repeat(200_000) + "#x".repeat(100_000));
    read("<p>".repeat(100_000));
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("refuses a page with an unreasonable number of elements", () => {
    expect(() => read("<i>".repeat(1_600_000))).toThrow(/too many elements/);
  });
});

describe("HTML reader: what lives somewhere else, and old markup", () => {
  it("names what a page embeds instead of dropping it", () => {
    const text = read(`<p>Watch:</p><iframe src="https://video.example/embed/1" title="Launch"></iframe><video src="/a.mp4" title="Demo"></video><audio><source src="/a.mp3"></audio><svg aria-label="Sales chart"><rect/></svg><iframe src="about:blank"></iframe>`);
    expect(text).toBe('Watch:\n\n[embedded page "Launch": https://video.example/embed/1] [video "Demo": /a.mp4] [audio: /a.mp3] [graphic: Sales chart]');
  });

  it("reads the markup of the nineties: upper case, unquoted attributes, font and center, frames", () => {
    const text = read(`<HTML><HEAD><TITLE>Old Page</TITLE></HEAD><BODY BGCOLOR=white><CENTER><FONT SIZE=+2 COLOR=red>Welcome</FONT></CENTER><P>First&nbsp;line<BR>second line<P>Link: <A HREF=page2.html>next</A><HR><FRAMESET><FRAME SRC="menu.html"></FRAMESET></BODY></HTML>`);
    expect(text).toBe("# Old Page\n\nWelcome\n\nFirst line\nsecond line\n\nLink: [next](page2.html)\n\n---\n\n[embedded page: menu.html]");
  });

  it("reads math as symbols in reading order, and ignores a placeholder alternative", () => {
    const text = read(`<p>If <math alttext="Alternative text not available"><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mfrac><mn>1</mn><mi>y</mi></mfrac></math> then</p><p><math alttext="x equals two"><mi>x</mi></math></p>`);
    expect(text).toBe("If x^2+1/y then\n\nx equals two");
  });
});
