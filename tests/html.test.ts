import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokenizeHtml, type HtmlToken, type TokenizerState } from "../src/parsers/htmltokens";

// html5lib-tests (MIT, tests/fixtures/html5lib/LICENSE), tokenizer/*.test at 224991ec10db04f056a89eed8b0bd8695fd2950e.
interface Case {
  description: string;
  input: string;
  output: unknown[];
  initialStates?: string[];
  lastStartTag?: string;
  doubleEscaped?: boolean;
}

const states: Record<string, TokenizerState> = {
  "Data state": "data",
  "PLAINTEXT state": "plaintext",
  "RCDATA state": "rcdata",
  "RAWTEXT state": "rawtext",
  "Script data state": "script",
  "CDATA section state": "cdata",
};

// The tests give attributes as an object, so their order is not part of the expectation.
function byName(a: unknown[], b: unknown[]): number {
  return String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0;
}

function unescape(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function expected(output: unknown[], doubleEscaped: boolean): unknown[] {
  const fix = (value: unknown): unknown => (doubleEscaped && typeof value === "string" ? unescape(value) : value);
  const out: unknown[] = [];
  for (const item of output) {
    if (item === "ParseError") continue;
    const [kind, ...rest] = item as unknown[];
    if (kind === "Character") {
      const last = out[out.length - 1] as unknown[] | undefined;
      if (last && last[0] === "Character") last[1] = (last[1] as string) + (fix(rest[0]) as string);
      else out.push(["Character", fix(rest[0])]);
    } else if (kind === "StartTag") {
      const attrs = Object.entries(rest[1] as Record<string, string>).map(([k, v]) => [fix(k), fix(v)] as [unknown, unknown]).sort(byName);
      out.push(["StartTag", fix(rest[0]), attrs, rest[2] === true]);
    } else if (kind === "EndTag") out.push(["EndTag", fix(rest[0])]);
    else if (kind === "Comment") out.push(["Comment", fix(rest[0])]);
    else out.push([kind, ...rest]);
  }
  return out;
}

function actual(input: string, state: TokenizerState, lastStartTag: string | undefined): unknown[] {
  const tokens: HtmlToken[] = [];
  tokenizeHtml(input, (token) => tokens.push(token), { initialState: state, lastStartTag, autoSwitch: false });
  const out: unknown[] = [];
  for (const token of tokens) {
    if (token.type === "text") {
      const last = out[out.length - 1] as unknown[] | undefined;
      if (last && last[0] === "Character") last[1] = (last[1] as string) + token.data;
      else out.push(["Character", token.data]);
    } else if (token.type === "start") out.push(["StartTag", token.name, [...token.attrs].sort(byName), token.selfClosing]);
    else if (token.type === "end") out.push(["EndTag", token.name]);
    else if (token.type === "comment") out.push(["Comment", token.data]);
    else out.push(["DOCTYPE", token.name]);
  }
  return out;
}

const dir = "tests/fixtures/html5lib/tokenizer";

describe("HTML tokenizer against html5lib's tokenizer tests", () => {
  let run = 0;
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".test")).sort()) {
    const cases = (JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as { tests?: Case[] }).tests ?? [];
    for (const test of cases) {
      const hasDoctype = test.output.some((item) => Array.isArray(item) && item[0] === "DOCTYPE");
      if (hasDoctype || /<!doctype/i.test(test.input)) {
        skipped.push(`${file}: ${test.description}`);
        continue;
      }
      for (const name of test.initialStates ?? ["Data state"]) {
        const state = states[name];
        const input = test.doubleEscaped ? unescape(test.input) : test.input;
        run += 1;
        const got = JSON.stringify(actual(input, state, test.lastStartTag));
        const want = JSON.stringify(expected(test.output, test.doubleEscaped === true));
        if (got !== want) failed.push(`${file}: ${test.description} [${name}]\n  want ${want}\n  got  ${got}`);
      }
    }
  }
  it("passes every test it runs", () => {
    expect(failed.slice(0, 12).join("\n")).toBe("");
    expect(run).toBeGreaterThan(4000);
  });
  it("leaves out only the tests that read a DOCTYPE's fields, which nothing here uses", () => {
    expect(skipped.length).toBeLessThan(1000);
  });
});

describe("encoding detection against html5lib's encoding tests", () => {
  const encodingDir = "tests/fixtures/html5lib/encoding";
  const cases: Array<{ name: string; data: Uint8Array; want: string }> = [];
  for (const file of ["tests1.dat", "tests2.dat"]) {
    const raw = readFileSync(`${encodingDir}/${file}`);
    const text = raw.toString("latin1");
    for (const block of text.split(/^#data\n/m).slice(1)) {
      const split = block.indexOf("\n#encoding\n");
      if (split < 0) continue;
      const data = Buffer.from(block.slice(0, split), "latin1");
      const want = block.slice(split + 11).split("\n")[0].trim();
      cases.push({ name: `${file}: ${block.slice(0, 50).replace(/\n/g, " ")}`, data, want });
    }
  }
  it("chooses the expected encoding for every test it can run", async () => {
    const { decodeMarkup, normalizeEncoding } = await import("../src/parsers/markupencoding");
    const failed: string[] = [];
    let ran = 0;
    for (const test of cases) {
      const want = normalizeEncoding(test.want);
      if (!want) continue;
      ran += 1;
      // html5lib's default for a file that declares nothing is windows-1252. This reader reads valid UTF-8 as UTF-8 first, so a test whose bytes are plain ASCII with no declaration can't tell the two apart.
      const got = decodeMarkup(test.data).encoding;
      if (got !== want && !(want === "windows-1252" && got === "utf-8" && test.data.every((b) => b < 0x80))) failed.push(`${test.name} want ${want} got ${got}`);
    }
    expect(failed.join("\n")).toBe("");
    expect(ran).toBeGreaterThan(60);
  });
});
