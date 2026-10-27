/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readHtml } from "../src/parsers/html";

// Pages and chapters written for Koncord's reader tests, one construct each (tests/fixtures/koncord/README.md).
const read = (path: string): string => readHtml(new Uint8Array(readFileSync(new URL(`./fixtures/koncord/${path}`, import.meta.url)))).text;

describe("Koncord's pages", () => {
  it("keeps words apart across block boundaries and keeps inline elements attached", () => {
    const text = read("reading/block-boundaries.html");
    expect(text).toContain("## Cooking Recipes and guides");
    expect(text).toContain("221B Baker Street\nLondon, and the rest");
    expect(text).toMatch(/Middle East\s+US opts not to back a ceasefire/);
    expect(text).toContain("so *emphasis*, stays attached");
    expect(text).toContain("C\no\nd\na");
  });

  it("reads what old markup still means: titles, ruby, code, and lines the author ended", () => {
    const text = read("reading/inline-meanings.html");
    expect(text).toContain("A heading with *an italic title* in it");
    expect(text).toContain("先生は漢字(かんじ)を読んだ");
    expect(text).toContain("Run `swift test` before `git push`");
    expect(text).toContain("The Pequod\nsailed on Christmas Day,\nand the whale\nwas waiting.");
  });

  it("leaves a page's own controls out of its prose", () => {
    const text = read("reading/widgets.html");
    expect(text).toContain("Mix the batter until smooth.");
    expect(text).not.toContain("rest it.replay");
    expect(text).not.toContain("Then rest it. replay");
  });

  it("reads a date, a value and a meter from their attributes when they hold no words", () => {
    const text = read("reading/entities.html");
    expect(text).toContain("updated 2026-09-16");
    expect(text).toContain("[meter: 0.5 of 1]");
    expect(text).toContain("forty-two, 7");
  });

  it("marks what was struck out of a sentence", () => {
    expect(read("reading/del-ins.html")).toContain("open ~~on Sundays~~ every day except Sunday");
  });

  it("numbers a list from where it says it starts", () => {
    expect(read("reading/lists.html")).toContain("5. Fifth step of the method\n6. Sixth step of the method");
  });

  it("keeps repeated list entries and table rows, which are data", () => {
    const text = read("reading/dedupe.html");
    expect(text).toContain("- Repeated entry\n- Repeated entry");
    expect(text).toContain("10–16 | 10–16\n10–16 | Closed");
  });
});

describe("Koncord's book chapters", () => {
  it("reads a self-closing paragraph as empty, not as open to the next end tag", () => {
    expect(read("epub/self-closing.xhtml")).toContain("## Chapter One\n\nThe first paragraph of the chapter.");
    expect(read("epub/title-self-closing.xhtml")).toMatch(/Para one\n\nPara two$/);
  });

  it("reads past an unclosed element and a nested same-name element", () => {
    expect(read("epub/unclosed.xhtml")).toMatch(/One\n\nTwo$/);
    expect(read("epub/nested.xhtml")).toContain("- Outer item\n  - Inner one\n  - Inner two\n- Second outer\n\n> A quoted paragraph.\n>\n> And another.");
  });

  it("drops U+FEFF and keeps the text around it", () => {
    expect(read("epub/feff.xhtml")).toMatch(/\nIt was—as I have said—a dreary night\.$/);
  });

  it("keeps a preformatted block's lines", () => {
    expect(read("epub/pre.xhtml")).toContain("```\nfirst line\nsecond line\n```\n\nAfter the pre.");
  });

  it("reads character references and non-breaking spaces with no DTD", () => {
    expect(read("epub/references.xhtml")).toContain("Darcy’s letter arrived. Copyright © 1813.\n\nThe end.");
    expect(read("epub/nbsp-no-dtd.xhtml")).toContain("One two\n\nThree");
  });

  it("does not run a script's CDATA as text", () => {
    expect(read("epub/cdata.xhtml")).toMatch(/A paragraph beside the script\.$/);
  });

  it("does not expand entities a DTD declares, and does not show the DTD", () => {
    const external = read("epub/external-entity.xhtml");
    expect(external).toContain("Before &ext; after");
    expect(external).not.toContain("]>");
    const laughs = read("epub/laughs.xhtml");
    expect(laughs).toContain("After the laughs.");
    expect(laughs).not.toContain("]>");
    expect(laughs.length).toBeLessThan(200);
  });

  it("reads a chapter encoded as UTF-16", () => {
    expect(read("epub/encoding.xhtml")).toContain("Café, naïve — 日本語");
  });

  it("reads prefixed MathML as symbols", () => {
    expect(read("epub/mathml.xhtml")).toContain("An equation: x=2");
  });
});
