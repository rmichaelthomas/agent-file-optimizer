// A PDF text reader. It reads the file's own structure: objects (including compressed object
// streams), the page tree, each page's fonts and their character maps, and the content stream's text
// operators, with positions, so words and lines come out the way they were laid out. It does not do
// OCR, does not read scanned pages, and does not open encrypted files. Text comes out in the order the
// PDF draws it, so a multi-column page can read column by column or interleave, depending on the writer.
import { Inflate, Unzlib } from "fflate";
import { GLYPH_UNICODE } from "./glyphs";
import { type BuiltinEncoding, cffEncoding, standardEncodingName, type1Encoding } from "./fontprogram";

// ------------------------------------------------------------------ values and lexer

class Name {
  constructor(readonly name: string) {}
}
class Ref {
  constructor(readonly num: number) {}
}
class Str {
  constructor(readonly value: string) {}
}
class Op {
  constructor(readonly op: string) {}
}
type Dict = Map<string, Value>;
type Value = number | boolean | null | Name | Ref | Str | Op | Value[] | Dict;

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

class Lexer {
  constructor(readonly src: string, public pos = 0, private readonly refs = true) {}

  skip(): void {
    const { src } = this;
    while (this.pos < src.length) {
      const code = src.charCodeAt(this.pos);
      if (WHITESPACE.has(code)) this.pos += 1;
      else if (code === 37) {
        while (this.pos < src.length && src.charCodeAt(this.pos) !== 10 && src.charCodeAt(this.pos) !== 13) this.pos += 1;
      } else break;
    }
  }

  atEnd(): boolean {
    this.skip();
    return this.pos >= this.src.length;
  }

  /** Reads one value. A bare keyword comes back as an Op. */
  value(depth = 0): Value | undefined {
    this.skip();
    const { src } = this;
    if (this.pos >= src.length || depth > 40) return undefined;
    const code = src.charCodeAt(this.pos);
    if (code === 47) return this.name();
    if (code === 40) return this.literalString();
    if (code === 60) {
      if (src.charCodeAt(this.pos + 1) === 60) return this.dict(depth);
      return this.hexString();
    }
    if (code === 91) return this.array(depth);
    if (code === 93 || code === 62 || code === 41 || code === 125 || code === 123) {
      this.pos += 1;
      return new Op(String.fromCharCode(code));
    }
    return this.word();
  }

  private name(): Name {
    this.pos += 1;
    let out = "";
    const { src } = this;
    while (this.pos < src.length) {
      const code = src.charCodeAt(this.pos);
      if (WHITESPACE.has(code) || DELIMITERS.has(code)) break;
      if (code === 35 && /^[0-9a-fA-F]{2}$/.test(src.slice(this.pos + 1, this.pos + 3))) {
        out += String.fromCharCode(Number.parseInt(src.slice(this.pos + 1, this.pos + 3), 16));
        this.pos += 3;
      } else {
        out += src[this.pos];
        this.pos += 1;
      }
    }
    return new Name(out);
  }

  private literalString(): Str {
    const { src } = this;
    this.pos += 1;
    let depth = 1;
    let out = "";
    while (this.pos < src.length) {
      const char = src[this.pos];
      this.pos += 1;
      if (char === "\\") {
        const next = src[this.pos];
        this.pos += 1;
        if (next === "n") out += "\n";
        else if (next === "r") out += "\r";
        else if (next === "t") out += "\t";
        else if (next === "b") out += "\b";
        else if (next === "f") out += "\f";
        else if (next >= "0" && next <= "7") {
          let octal = next;
          while (octal.length < 3 && src[this.pos] >= "0" && src[this.pos] <= "7") {
            octal += src[this.pos];
            this.pos += 1;
          }
          out += String.fromCharCode(Number.parseInt(octal, 8) & 255);
        } else if (next === "\r") {
          if (src[this.pos] === "\n") this.pos += 1;
        } else if (next !== "\n" && next !== undefined) out += next;
      } else if (char === "(") {
        depth += 1;
        out += char;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
        out += char;
      } else out += char;
    }
    return new Str(out);
  }

  private hexString(): Str {
    const end = this.src.indexOf(">", this.pos);
    const body = this.src.slice(this.pos + 1, end < 0 ? this.src.length : end).replace(/[^0-9a-fA-F]/g, "");
    this.pos = end < 0 ? this.src.length : end + 1;
    const padded = body.length % 2 === 1 ? `${body}0` : body;
    let out = "";
    for (let i = 0; i < padded.length; i += 2) out += String.fromCharCode(Number.parseInt(padded.slice(i, i + 2), 16));
    return new Str(out);
  }

  private array(depth: number): Value[] {
    this.pos += 1;
    const items: Value[] = [];
    for (;;) {
      const item = this.value(depth + 1);
      if (item === undefined) break;
      if (item instanceof Op) {
        if (item.op === "]") break;
        continue;
      }
      items.push(item);
    }
    return items;
  }

  private dict(depth: number): Dict {
    this.pos += 2;
    const map: Dict = new Map();
    for (;;) {
      const key = this.value(depth + 1);
      if (key === undefined) break;
      if (key instanceof Op) {
        if (key.op === ">") {
          if (this.src.charCodeAt(this.pos) === 62) this.pos += 1;
          break;
        }
        continue;
      }
      if (!(key instanceof Name)) continue;
      const value = this.value(depth + 1);
      if (value === undefined) break;
      if (value instanceof Op) {
        if (value.op === ">") {
          if (this.src.charCodeAt(this.pos) === 62) this.pos += 1;
          break;
        }
        continue;
      }
      map.set(key.name, value);
    }
    return map;
  }

  private word(): Value {
    const { src } = this;
    const start = this.pos;
    while (this.pos < src.length) {
      const code = src.charCodeAt(this.pos);
      if (WHITESPACE.has(code) || DELIMITERS.has(code)) break;
      this.pos += 1;
    }
    if (this.pos === start) {
      this.pos += 1;
      return new Op(src[start]);
    }
    const token = src.slice(start, this.pos);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      const number = Number(token);
      if (this.refs && Number.isInteger(number) && number >= 0 && !/^[+-]/.test(token)) {
        const saved = this.pos;
        const match = /^\s+(\d+)\s+R(?![A-Za-z0-9])/.exec(src.slice(saved, saved + 24));
        if (match) {
          this.pos = saved + match[0].length;
          return new Ref(number);
        }
      }
      return number;
    }
    if (/^[+-]*\.?\d/.test(token) && /^[+-]*\d*\.?\d*$/.test(token)) return Number(token.replace(/^[+-]*/, (signs) => (signs.includes("-") ? "-" : "")));
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    return new Op(token);
  }
}

function asNumber(value: Value | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ------------------------------------------------------------------ filters

const MAX_STREAM_BYTES = 24 * 1024 * 1024;
let budget = 0;
let workLeft = 0;

function inflateLimited(data: Uint8Array): Uint8Array {
  const run = (make: (cb: (chunk: Uint8Array) => void) => { push(chunk: Uint8Array, final?: boolean): void }): Uint8Array => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const stream = make((chunk) => {
      total += chunk.length;
      budget -= chunk.length;
      if (total > MAX_STREAM_BYTES || budget < 0) throw new Error("A PDF stream is larger than this reader will expand.");
      chunks.push(chunk);
    });
    try {
      stream.push(data, true);
    } catch (error) {
      // A damaged tail still leaves the part that did decode, which is usually most of the text.
      if (total === 0 || (error instanceof Error && /larger than this reader/.test(error.message))) throw error;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };
  try {
    return run((cb) => new Unzlib(cb));
  } catch (error) {
    if (error instanceof Error && /larger than this reader/.test(error.message)) throw error;
    return run((cb) => new Inflate(cb));
  }
}

function ascii85(data: string): Uint8Array {
  const text = data.replace(/\s+/g, "");
  const end = text.indexOf("~>");
  const body = (end >= 0 ? text.slice(0, end) : text).replace(/^<~/, "");
  const out: number[] = [];
  let group: number[] = [];
  for (const char of body) {
    if (char === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = char.charCodeAt(0) - 33;
    if (code < 0 || code > 84) continue;
    group.push(code);
    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const count = group.length;
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...bytes.slice(0, count - 1));
  }
  return Uint8Array.from(out);
}

function asciiHex(data: string): Uint8Array {
  const hex = data.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function runLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; ) {
    const length = data[i];
    i += 1;
    if (length === 128) break;
    if (length < 128) {
      for (let j = 0; j <= length && i < data.length; j += 1) out.push(data[i++]);
    } else {
      const byte = data[i++];
      for (let j = 0; j < 257 - length; j += 1) out.push(byte);
    }
    if (out.length > MAX_STREAM_BYTES) throw new Error("A PDF stream is larger than this reader will expand.");
  }
  return Uint8Array.from(out);
}

function lzw(data: Uint8Array, earlyChange: number): Uint8Array {
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < 256; i += 1) table.push([i]);
    table.push([], []);
  };
  reset();
  let bits = 9;
  let buffer = 0;
  let bitCount = 0;
  let previous: number[] | null = null;
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= bits) {
      const code = (buffer >> (bitCount - bits)) & ((1 << bits) - 1);
      bitCount -= bits;
      buffer &= (1 << bitCount) - 1;
      if (code === 256) {
        reset();
        bits = 9;
        previous = null;
        continue;
      }
      if (code === 257) return Uint8Array.from(out);
      let entry: number[];
      if (code < table.length) entry = table[code];
      else if (previous) entry = [...previous, previous[0]];
      else return Uint8Array.from(out);
      out.push(...entry);
      if (out.length > MAX_STREAM_BYTES) throw new Error("A PDF stream is larger than this reader will expand.");
      if (previous) table.push([...previous, entry[0]]);
      previous = entry;
      const size = table.length + earlyChange;
      bits = size >= 2048 ? 12 : size >= 1024 ? 11 : size >= 512 ? 10 : 9;
    }
  }
  return Uint8Array.from(out);
}

function applyPredictor(data: Uint8Array, parms: Dict | undefined): Uint8Array {
  const predictor = asNumber(parms?.get("Predictor"), 1);
  if (predictor < 10) return data;
  const colors = asNumber(parms?.get("Colors"), 1);
  const bpc = asNumber(parms?.get("BitsPerComponent"), 8);
  const columns = asNumber(parms?.get("Columns"), 1);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowBytes = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let row = 0; row < rows; row += 1) {
    const filter = data[row * (rowBytes + 1)];
    const inStart = row * (rowBytes + 1) + 1;
    const outStart = row * rowBytes;
    for (let i = 0; i < rowBytes; i += 1) {
      const raw = data[inStart + i];
      const left = i >= bpp ? out[outStart + i - bpp] : 0;
      const up = row > 0 ? out[outStart - rowBytes + i] : 0;
      const upLeft = row > 0 && i >= bpp ? out[outStart - rowBytes + i - bpp] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[outStart + i] = value & 255;
    }
  }
  return out;
}

/** One character per byte. TextDecoder("latin1") is really windows-1252 and would change bytes 0x80 to 0x9F, so this is done by hand. */
function toLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

// ------------------------------------------------------------------ document

interface PdfObject {
  value: Value;
  streamStart?: number;
  streamEnd?: number;
  data?: Uint8Array;
}

class PdfDocument {
  readonly objects = new Map<number, PdfObject>();
  readonly trailer: Dict = new Map();
  readonly bytes: Uint8Array;
  readonly src: string;
  encrypted = false;
  damaged = 0;
  private readonly decoded = new Map<number, Uint8Array | null>();

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.src = toLatin1(bytes);
    this.scan();
  }

  private scan(): void {
    const { src } = this;
    // Find "N G obj" by looking for "obj" and reading a few characters back, so a file full of digits cannot make the scan slow.
    let cursor = 0;
    for (;;) {
      const at = src.indexOf("obj", cursor);
      if (at < 0) break;
      cursor = at + 3;
      const match = /(\d{1,10})\s+(\d{1,5})\s+$/.exec(src.slice(Math.max(0, at - 24), at));
      if (!match || (src[at - 1] !== " " && src[at - 1] !== "\n" && src[at - 1] !== "\r" && src[at - 1] !== "\t")) continue;
      const num = Number(match[1]);
      const lexer = new Lexer(src, at + 3);
      const value = lexer.value();
      if (value === undefined || value instanceof Op) continue;
      const object: PdfObject = { value };
      lexer.skip();
      if (value instanceof Map && src.startsWith("stream", lexer.pos)) {
        let start = lexer.pos + 6;
        if (src[start] === "\r" && src[start + 1] === "\n") start += 2;
        else if (src[start] === "\n" || src[start] === "\r") start += 1;
        let end = -1;
        const length = value.get("Length");
        if (typeof length === "number" && length >= 0 && start + length <= src.length) {
          const tail = src.slice(start + length, start + length + 20);
          if (/^\s*endstream/.test(tail)) end = start + length;
        }
        if (end < 0) {
          const found = src.indexOf("endstream", start);
          // The end-of-line before "endstream" is left on: a compressed stream can legitimately end in that byte, and a decoder ignores one extra.
          end = found < 0 ? src.length : found;
        }
        object.streamStart = start;
        object.streamEnd = end;
        cursor = Math.max(end, cursor);
      }
      this.objects.set(num, object);
      const type = value instanceof Map ? value.get("Type") : undefined;
      if (value instanceof Map && type instanceof Name && type.name === "XRef") this.mergeTrailer(value);
    }
    const trailers = /\btrailer\b/g;
    for (;;) {
      const match = trailers.exec(src);
      if (!match) break;
      const value = new Lexer(src, match.index + 7).value();
      if (value instanceof Map) this.mergeTrailer(value);
    }
    // Compressed objects live inside object streams.
    for (const [num, object] of [...this.objects]) {
      const dict = object.value;
      if (!(dict instanceof Map) || object.streamStart === undefined) continue;
      const type = dict.get("Type");
      if (!(type instanceof Name) || type.name !== "ObjStm") continue;
      const data = this.stream(num);
      if (!data) continue;
      const text = toLatin1(data);
      const count = asNumber(dict.get("N"));
      const first = asNumber(dict.get("First"));
      const header = new Lexer(text, 0, false);
      const entries: Array<[number, number]> = [];
      for (let i = 0; i < count; i += 1) {
        const objectNumber = header.value();
        const offset = header.value();
        if (typeof objectNumber === "number" && typeof offset === "number") entries.push([objectNumber, offset]);
      }
      for (const [objectNumber, offset] of entries) {
        if (this.objects.has(objectNumber)) continue;
        const value = new Lexer(text, first + offset).value();
        if (value !== undefined && !(value instanceof Op)) this.objects.set(objectNumber, { value });
      }
    }
  }

  private mergeTrailer(dict: Dict): void {
    for (const key of ["Root", "Info", "Encrypt"]) {
      const value = dict.get(key);
      if (value !== undefined) this.trailer.set(key, value);
    }
    if (dict.has("Encrypt")) this.encrypted = true;
  }

  resolve(value: Value | undefined, depth = 0): Value | undefined {
    let current = value;
    for (let i = 0; current instanceof Ref && i < 20 && depth < 20; i += 1) current = this.objects.get(current.num)?.value;
    return current instanceof Ref ? undefined : current;
  }

  dict(value: Value | undefined): Dict | undefined {
    const resolved = this.resolve(value);
    return resolved instanceof Map ? resolved : undefined;
  }

  array(value: Value | undefined): Value[] {
    const resolved = this.resolve(value);
    return Array.isArray(resolved) ? resolved : [];
  }

  nameOf(value: Value | undefined): string | undefined {
    const resolved = this.resolve(value);
    return resolved instanceof Name ? resolved.name : undefined;
  }

  /** The decoded bytes of a stream object, or null for an image or an unsupported filter. */
  stream(num: number): Uint8Array | null {
    const cached = this.decoded.get(num);
    if (cached !== undefined) return cached;
    const object = this.objects.get(num);
    let result: Uint8Array | null = null;
    if (object && object.streamStart !== undefined && object.streamEnd !== undefined && object.value instanceof Map) {
      try {
        result = this.decode(object.value, this.bytes.subarray(object.streamStart, object.streamEnd));
      } catch (error) {
        if (error instanceof Error && /larger than this reader/.test(error.message)) throw error;
        this.damaged += 1;
      }
    }
    this.decoded.set(num, result);
    return result;
  }

  streamOf(value: Value | undefined): Uint8Array | null {
    if (!(value instanceof Ref)) return null;
    return this.stream(value.num);
  }

  private decode(dict: Dict, raw: Uint8Array): Uint8Array | null {
    const filterValue = this.resolve(dict.get("Filter") ?? dict.get("F"));
    const filters = Array.isArray(filterValue) ? filterValue.map((f) => this.nameOf(f)) : filterValue instanceof Name ? [filterValue.name] : [];
    const parmsValue = this.resolve(dict.get("DecodeParms") ?? dict.get("DP"));
    const parmsList: Array<Dict | undefined> = Array.isArray(parmsValue) ? parmsValue.map((p) => this.dict(p)) : [parmsValue instanceof Map ? parmsValue : undefined];
    let data = raw;
    for (let i = 0; i < filters.length; i += 1) {
      const filter = filters[i];
      const parms = parmsList[i];
      if (filter === "FlateDecode" || filter === "Fl") data = applyPredictor(inflateLimited(data), parms);
      else if (filter === "LZWDecode" || filter === "LZW") data = applyPredictor(lzw(data, asNumber(parms?.get("EarlyChange"), 1)), parms);
      else if (filter === "ASCII85Decode" || filter === "A85") data = ascii85(toLatin1(data));
      else if (filter === "ASCIIHexDecode" || filter === "AHx") data = asciiHex(toLatin1(data));
      else if (filter === "RunLengthDecode" || filter === "RL") data = runLength(data);
      else return null;
    }
    return data;
  }
}

// ------------------------------------------------------------------ glyph names and encodings

function glyphToUnicode(name: string): string | undefined {
  const known = GLYPH_UNICODE[name];
  if (known !== undefined) return String.fromCodePoint(known);
  if (name === "nbspace") return "\u00a0";
  if (name === "sfthyphen") return "\u00ad";
  let match = /^uni([0-9A-Fa-f]{4})/.exec(name);
  if (match) return String.fromCodePoint(Number.parseInt(match[1], 16));
  match = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (match) return String.fromCodePoint(Number.parseInt(match[1], 16));
  const dot = name.indexOf(".");
  if (dot > 0) return glyphToUnicode(name.slice(0, dot));
  return undefined;
}

const MAC_HIGH = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
const WIN_HIGH = "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ";

function baseEncoding(name: string | undefined): (code: number) => string | undefined {
  return (code) => {
    if (code >= 32 && code < 127) return String.fromCharCode(code);
    if (code === 9 || code === 10 || code === 13) return " ";
    if (code < 128) return undefined;
    const table = name === "MacRomanEncoding" ? MAC_HIGH : WIN_HIGH;
    const char = table[code - 128];
    return char === undefined || char === "�" ? undefined : char;
  };
}

// ------------------------------------------------------------------ fonts

interface CodespaceRange {
  bytes: number;
  low: number;
  high: number;
}

interface FontInfo {
  composite: boolean;
  codespace: CodespaceRange[];
  toUnicode: Map<number, string> | null;
  simple: (code: number) => string | undefined;
  widths: Map<number, number>;
  defaultWidth: number;
  name: string;
}

function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace(/\s+/g, "") || "0", 16);
}

function utf16(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 3 < clean.length + 1 && i < clean.length; i += 4) out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 4).padEnd(4, "0"), 16));
  return out;
}

function parseCMap(text: string): { map: Map<number, string>; codespace: CodespaceRange[] } {
  const map = new Map<number, string>();
  const codespace: CodespaceRange[] = [];
  for (const section of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const pairs = [...section[1].matchAll(/<([0-9a-fA-F\s]*)>/g)].map((m) => m[1].replace(/\s+/g, ""));
    for (let i = 0; i + 1 < pairs.length; i += 2) codespace.push({ bytes: Math.max(1, Math.round(pairs[i].length / 2)), low: hexToNumber(pairs[i]), high: hexToNumber(pairs[i + 1]) });
  }
  for (const section of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const pairs = [...section[1].matchAll(/<([0-9a-fA-F\s]*)>/g)].map((m) => m[1]);
    for (let i = 0; i + 1 < pairs.length; i += 2) map.set(hexToNumber(pairs[i]), utf16(pairs[i + 1]));
  }
  for (const section of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const tokens = [...section[1].matchAll(/<([0-9a-fA-F\s]*)>|\[|\]/g)];
    for (let i = 0; i < tokens.length; ) {
      const low = tokens[i];
      const high = tokens[i + 1];
      const target = tokens[i + 2];
      if (!low || low[0] === "[" || low[0] === "]" || low[1] === undefined || !high || high[0] === "[" || high[1] === undefined || !target) {
        i += 1;
        continue;
      }
      const lo = hexToNumber(low[1]);
      const hi = hexToNumber(high[1]);
      if (target[0] === "[") {
        let j = i + 3;
        let code = lo;
        while (j < tokens.length && tokens[j][0] !== "]") {
          if (code <= hi) map.set(code, utf16(tokens[j][1] ?? ""));
          code += 1;
          j += 1;
        }
        i = j + 1;
      } else {
        const start = utf16(target[1]);
        if (hi - lo <= 0xffff && start.length > 0) {
          const last = start.charCodeAt(start.length - 1);
          const prefix = start.slice(0, -1);
          for (let code = lo; code <= hi; code += 1) map.set(code, prefix + String.fromCharCode(last + (code - lo)));
        }
        i += 3;
      }
    }
  }
  return { map, codespace };
}

function buildFont(doc: PdfDocument, dict: Dict): FontInfo {
  const subtype = doc.nameOf(dict.get("Subtype"));
  const composite = subtype === "Type0";
  const font: FontInfo = {
    composite,
    codespace: [],
    toUnicode: null,
    simple: baseEncoding("WinAnsiEncoding"),
    widths: new Map(),
    defaultWidth: composite ? 1000 : 500,
    name: doc.nameOf(dict.get("BaseFont")) ?? "font",
  };

  const toUnicodeData = doc.streamOf(dict.get("ToUnicode"));
  if (toUnicodeData) {
    const parsed = parseCMap(toLatin1(toUnicodeData));
    if (parsed.map.size > 0) font.toUnicode = parsed.map;
    font.codespace = parsed.codespace;
  }

  const encoding = doc.resolve(dict.get("Encoding"));
  const encodingName = encoding instanceof Name ? encoding.name : doc.nameOf(dict.get("Encoding"));

  if (composite) {
    if (encoding instanceof Ref || encoding instanceof Map) {
      const data = doc.streamOf(dict.get("Encoding"));
      if (data && font.codespace.length === 0) font.codespace = parseCMap(toLatin1(data)).codespace;
    }
    if (font.codespace.length === 0) font.codespace = [{ bytes: 2, low: 0, high: 0xffff }];
    const descendant = doc.dict(doc.array(dict.get("DescendantFonts"))[0]);
    if (descendant) {
      font.defaultWidth = asNumber(doc.resolve(descendant.get("DW")), 1000);
      const widths = doc.array(descendant.get("W"));
      for (let i = 0; i < widths.length; ) {
        const first = asNumber(doc.resolve(widths[i]), -1);
        const second = doc.resolve(widths[i + 1]);
        if (Array.isArray(second)) {
          second.forEach((w, k) => font.widths.set(first + k, asNumber(doc.resolve(w), font.defaultWidth)));
          i += 2;
        } else {
          const last = asNumber(second, first);
          const width = asNumber(doc.resolve(widths[i + 2]), font.defaultWidth);
          for (let code = first; code <= last && code - first < 70000; code += 1) font.widths.set(code, width);
          i += 3;
        }
      }
    }
    return font;
  }

  // Simple fonts: a byte is a character. The encoding, with any Differences, says which one. With no
  // encoding named, the font program's own built-in encoding applies, and failing that, StandardEncoding.
  const descriptor = doc.dict(dict.get("FontDescriptor"));
  let base: ((code: number) => string | undefined) | null = null;
  if (encodingName === "MacRomanEncoding" || encodingName === "WinAnsiEncoding") base = baseEncoding(encodingName);
  const differences = new Map<number, string>();
  if (encoding instanceof Map) {
    const baseName = doc.nameOf(encoding.get("BaseEncoding"));
    if (baseName === "MacRomanEncoding" || baseName === "WinAnsiEncoding") base = baseEncoding(baseName);
    let code = 0;
    for (const item of doc.array(encoding.get("Differences"))) {
      const resolved = doc.resolve(item);
      if (typeof resolved === "number") code = resolved;
      else if (resolved instanceof Name) {
        const char = glyphToUnicode(resolved.name);
        if (char !== undefined) differences.set(code, char);
        code += 1;
      }
    }
  }
  if (!base) {
    let program: BuiltinEncoding | null = null;
    try {
      const type1 = doc.streamOf(descriptor?.get("FontFile"));
      const cff = type1 ? null : doc.streamOf(descriptor?.get("FontFile3"));
      if (type1) program = type1Encoding(type1);
      else if (cff) program = cffEncoding(cff);
    } catch {
      program = null;
    }
    const standard = (code: number): string | undefined => {
      const name = standardEncodingName(code);
      return name ? glyphToUnicode(name) : code === 32 ? " " : undefined;
    };
    if (program instanceof Map) {
      const builtin = program;
      base = (code) => {
        const name = builtin.get(code);
        return name ? glyphToUnicode(name) ?? standard(code) : standard(code);
      };
    } else if (program === "standard" || subtype !== "TrueType") base = standard;
    else base = baseEncoding("WinAnsiEncoding");
  }
  const chosen = base;
  font.simple = (code) => differences.get(code) ?? chosen(code);
  const firstChar = asNumber(doc.resolve(dict.get("FirstChar")));
  const widths = doc.array(dict.get("Widths"));
  widths.forEach((w, i) => font.widths.set(firstChar + i, asNumber(doc.resolve(w), 0)));
  font.defaultWidth = asNumber(doc.resolve(descriptor?.get("MissingWidth")), widths.length > 0 ? 0 : 500);
  if (widths.length === 0) font.defaultWidth = 500;
  return font;
}

function readCode(font: FontInfo, text: string, index: number): { code: number; length: number } {
  if (!font.composite) return { code: text.charCodeAt(index) & 255, length: 1 };
  let code = 0;
  for (let length = 1; length <= 4 && index + length <= text.length; length += 1) {
    code = code * 256 + (text.charCodeAt(index + length - 1) & 255);
    if (font.codespace.some((range) => range.bytes === length && code >= range.low && code <= range.high)) return { code, length };
  }
  const length = Math.min(2, text.length - index) || 1;
  let fallback = 0;
  for (let i = 0; i < length; i += 1) fallback = fallback * 256 + (text.charCodeAt(index + i) & 255);
  return { code: fallback, length };
}

const FALLBACK_FONT: FontInfo = {
  composite: false,
  codespace: [],
  toUnicode: null,
  simple: baseEncoding("WinAnsiEncoding"),
  widths: new Map(),
  defaultWidth: 500,
  name: "default",
};

// ------------------------------------------------------------------ content streams

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

interface Run {
  text: string;
  x: number;
  y: number;
  endX: number;
  size: number;
  rotated: boolean;
}

interface GraphicsState {
  ctm: Matrix;
  font: FontInfo;
  size: number;
  charSpace: number;
  wordSpace: number;
  scale: number;
  leading: number;
  rise: number;
}

interface PageContext {
  runs: Run[];
  unmapped: number;
  decoded: number;
  hasImages: boolean;
  steps: number;
}

const MAX_STEPS = 6_000_000;

function interpret(doc: PdfDocument, source: string, resources: Dict | undefined, base: Matrix, page: PageContext, fonts: Map<Dict, FontInfo>, depth: number): void {
  if (depth > 6) return;
  const lexer = new Lexer(source, 0, false);
  const state: GraphicsState = { ctm: base, font: FALLBACK_FONT, size: 12, charSpace: 0, wordSpace: 0, scale: 1, leading: 0, rise: 0 };
  const stack: GraphicsState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let operands: Value[] = [];
  const fontResources = doc.dict(resources?.get("Font"));
  const xObjects = doc.dict(resources?.get("XObject"));

  const num = (index: number): number => asNumber(operands[index]);

  const show = (text: string): void => {
    const font = state.font;
    let out = "";
    const trm0 = multiply([state.size * state.scale, 0, 0, state.size, 0, state.rise], multiply(tm, state.ctm));
    let advance = 0;
    let trailing = 0;
    for (let i = 0; i < text.length; ) {
      const { code, length } = readCode(font, text, i);
      const raw = text.slice(i, i + length);
      i += length;
      let char = font.toUnicode?.get(code);
      if (char === undefined && !font.composite) char = font.simple(code);
      page.decoded += 1;
      if (char === undefined) {
        page.unmapped += 1;
        char = "";
      }
      if (char === "\u0000") char = "";
      out += char;
      // Wide character spacing between glyphs is how some writers (troff-style) draw the gap between two words.
      if (i < text.length && char !== " " && char !== "" && state.charSpace > 0.2 * state.size) out += " ";
      const widthUnits = font.widths.get(code) ?? (raw === " " ? 250 : font.defaultWidth);
      const isSpace = length === 1 && code === 32;
      trailing = (state.charSpace + (isSpace ? state.wordSpace : 0)) * state.scale;
      advance += ((widthUnits / 1000) * state.size) * state.scale + trailing;
    }
    page.steps += text.length;
    const endMatrix = multiply([1, 0, 0, 1, advance, 0], tm);
    // Where the last glyph visibly ends: spacing added after it is not part of the word.
    const trmEnd = multiply([1, 0, 0, 1, -trailing, state.rise], multiply(endMatrix, state.ctm));
    const rotated = Math.abs(trm0[1]) > 0.2 * Math.abs(trm0[0]) + 0.001 && Math.abs(trm0[1]) > 0.5;
    const size = Math.hypot(trm0[2], trm0[3]) || Math.abs(state.size) || 12;
    if (out.length > 0) page.runs.push({ text: out, x: trm0[4], y: trm0[5], endX: trmEnd[4], size, rotated });
    tm = endMatrix;
  };

  const adjust = (amount: number): void => {
    tm = multiply([1, 0, 0, 1, (-amount / 1000) * state.size * state.scale, 0], tm);
  };

  const nextLine = (tx: number, ty: number): void => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  for (;;) {
    const token = lexer.value();
    if (token === undefined) break;
    page.steps += 1;
    workLeft -= 1;
    if (page.steps > MAX_STEPS || workLeft < 0) throw new Error("This PDF is too large to read in full.");
    if (!(token instanceof Op)) {
      operands.push(token);
      if (operands.length > 600) operands = operands.slice(-100);
      continue;
    }
    switch (token.op) {
      case "q":
        stack.push({ ...state });
        break;
      case "Q": {
        const saved = stack.pop();
        if (saved) Object.assign(state, saved);
        break;
      }
      case "cm":
        if (operands.length >= 6) state.ctm = multiply([num(0), num(1), num(2), num(3), num(4), num(5)], state.ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf": {
        const name = operands[0] instanceof Name ? operands[0].name : undefined;
        state.size = num(1) || state.size;
        const fontDict = name ? doc.dict(fontResources?.get(name)) : undefined;
        if (fontDict) {
          let info = fonts.get(fontDict);
          if (!info) {
            info = buildFont(doc, fontDict);
            fonts.set(fontDict, info);
          }
          state.font = info;
        } else state.font = FALLBACK_FONT;
        break;
      }
      case "Tc":
        state.charSpace = num(0);
        break;
      case "Tw":
        state.wordSpace = num(0);
        break;
      case "Tz":
        state.scale = (num(0) || 100) / 100;
        break;
      case "TL":
        state.leading = num(0);
        break;
      case "Ts":
        state.rise = num(0);
        break;
      case "Td":
        nextLine(num(0), num(1));
        break;
      case "TD":
        state.leading = -num(1);
        nextLine(num(0), num(1));
        break;
      case "Tm":
        if (operands.length >= 6) {
          tlm = [num(0), num(1), num(2), num(3), num(4), num(5)];
          tm = tlm;
        }
        break;
      case "T*":
        nextLine(0, -state.leading);
        break;
      case "Tj":
        if (operands[0] instanceof Str) show(operands[0].value);
        break;
      case "'":
        nextLine(0, -state.leading);
        if (operands[0] instanceof Str) show(operands[0].value);
        break;
      case '"':
        state.wordSpace = num(0);
        state.charSpace = num(1);
        nextLine(0, -state.leading);
        if (operands[2] instanceof Str) show(operands[2].value);
        break;
      case "TJ": {
        const items = operands[0];
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item instanceof Str) show(item.value);
            else if (typeof item === "number") adjust(item);
          }
        }
        break;
      }
      case "Do": {
        const name = operands[0] instanceof Name ? operands[0].name : undefined;
        const entry = name ? xObjects?.get(name) : undefined;
        const form = doc.dict(entry);
        if (form && doc.nameOf(form.get("Subtype")) === "Form" && entry instanceof Ref) {
          const data = doc.stream(entry.num);
          if (data) {
            const matrix = doc.array(form.get("Matrix")).map((v) => asNumber(doc.resolve(v)));
            const m: Matrix = matrix.length === 6 ? [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]] : IDENTITY;
            interpret(doc, toLatin1(data), doc.dict(form.get("Resources")) ?? resources, multiply(m, state.ctm), page, fonts, depth + 1);
          }
        } else if (form && doc.nameOf(form.get("Subtype")) === "Image") page.hasImages = true;
        break;
      }
      case "BI": {
        // An inline image: skip its data up to the EI that ends it.
        const rest = lexer.src;
        const idMatch = /\sID\s/.exec(rest.slice(lexer.pos, lexer.pos + 4000));
        if (!idMatch) return;
        const dataStart = lexer.pos + idMatch.index + 1;
        const end = /\sEI(?=[\s]|$)/g;
        end.lastIndex = dataStart + 3;
        const found = end.exec(rest);
        lexer.pos = found ? found.index + found[0].length : rest.length;
        page.hasImages = true;
        break;
      }
      default:
        break;
    }
    operands = [];
  }
}

// ------------------------------------------------------------------ pages and output

const LIGATURES: Record<string, string> = { "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st" };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function runsToText(runs: Run[]): string {
  const lines: Array<{ y: number; size: number; text: string; endX: number }> = [];
  for (const run of runs) {
    const last = lines[lines.length - 1];
    const sameLine = last && !run.rotated && Math.abs(run.y - last.y) <= 0.45 * Math.max(run.size, 1) && run.x > last.endX - 1.5 * run.size;
    if (sameLine) {
      const gap = run.x - last.endX;
      const needsSpace = gap > 0.12 * run.size && !/\s$/.test(last.text) && !/^\s/.test(run.text);
      last.text += (needsSpace ? " " : "") + run.text;
      last.endX = run.endX;
    } else {
      lines.push({ y: run.y, size: run.size, text: run.text, endX: run.endX });
    }
  }
  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const dy = Math.abs(lines[i - 1].y - lines[i].y);
    if (dy > 0.5 * lines[i].size && dy < 4 * lines[i].size) pitches.push(dy);
  }
  const pitch = median(pitches);
  const out: string[] = [];
  lines.forEach((line, i) => {
    const text = line.text.replace(/[\ufb00-\ufb06]/g, (ligature) => LIGATURES[ligature] ?? ligature).replace(/[ \t\u00a0]+/g, " ").replace(/[\u0000-\u001f]/g, "").trim();
    if (!text) return;
    if (i > 0 && pitch > 0 && Math.abs(lines[i - 1].y - line.y) > 1.7 * pitch) out.push("");
    out.push(text);
  });
  return out.join("\n");
}

function pdfString(value: string): string {
  if (value.startsWith("þÿ")) {
    let out = "";
    for (let i = 2; i + 1 < value.length; i += 2) out += String.fromCharCode((value.charCodeAt(i) << 8) | value.charCodeAt(i + 1));
    return out;
  }
  return value;
}

export interface PdfResult {
  pages: string[];
  meta: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
}

const MAX_PAGES = 400;
const MAX_OUTPUT_CHARS = 1_500_000;

export function readPdf(bytes: Uint8Array): PdfResult {
  budget = 64 * 1024 * 1024;
  workLeft = 60_000_000;
  const warnings: string[] = [];
  const doc = new PdfDocument(bytes);
  if (doc.encrypted) {
    return { pages: [], meta: [], warnings: ["This PDF is encrypted, so its text was not read. The original was preserved."], confidence: "low" };
  }

  const pageDicts: Array<{ dict: Dict; resources: Dict | undefined }> = [];
  const seen = new Set<Dict>();
  const walk = (value: Value | undefined, inherited: Dict | undefined, depth: number): void => {
    const node = doc.dict(value);
    if (!node || seen.has(node) || depth > 40) return;
    seen.add(node);
    const resources = doc.dict(node.get("Resources")) ?? inherited;
    const kids = doc.resolve(node.get("Kids"));
    if (Array.isArray(kids)) for (const kid of kids) walk(kid, resources, depth + 1);
    else if (doc.nameOf(node.get("Type")) !== "Pages") pageDicts.push({ dict: node, resources });
  };
  const root = doc.dict(doc.trailer.get("Root")) ?? [...doc.objects.values()].map((o) => o.value).find((v): v is Dict => v instanceof Map && doc.nameOf(v.get("Type")) === "Catalog");
  if (root) walk(root.get("Pages"), undefined, 0);
  if (pageDicts.length === 0) {
    for (const object of doc.objects.values()) {
      if (object.value instanceof Map && doc.nameOf(object.value.get("Type")) === "Page") pageDicts.push({ dict: object.value, resources: doc.dict(object.value.get("Resources")) });
    }
  }

  const fonts = new Map<Dict, FontInfo>();
  const pages: string[] = [];
  let imageOnly = 0;
  let decoded = 0;
  let unmapped = 0;
  let totalChars = 0;

  const readPage = (source: string, resources: Dict | undefined): string => {
    const context: PageContext = { runs: [], unmapped: 0, decoded: 0, hasImages: false, steps: 0 };
    interpret(doc, source, resources, IDENTITY, context, fonts, 0);
    decoded += context.decoded;
    unmapped += context.unmapped;
    const text = runsToText(context.runs);
    if (!text && context.hasImages) imageOnly += 1;
    return text;
  };

  if (pageDicts.length > 0) {
    if (pageDicts.length > MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} of ${pageDicts.length} pages were read.`);
    for (const { dict, resources } of pageDicts.slice(0, MAX_PAGES)) {
      const contents = doc.resolve(dict.get("Contents"));
      const parts = Array.isArray(contents) ? contents : contents === undefined ? [] : [dict.get("Contents")];
      let source = "";
      for (const part of parts) {
        const data = doc.streamOf(part);
        if (data) source += `${toLatin1(data)}\n`;
      }
      const text = source ? readPage(source, resources) : "";
      totalChars += text.length;
      pages.push(text);
      if (totalChars > MAX_OUTPUT_CHARS) {
        warnings.push("The text is long, so reading stopped early. The original has the rest.");
        break;
      }
    }
  } else {
    // No page tree (a damaged or minimal file): read every content-like stream as one page.
    let source = "";
    for (const [num, object] of doc.objects) {
      if (object.streamStart === undefined || !(object.value instanceof Map)) continue;
      const type = doc.nameOf(object.value.get("Type"));
      const subtype = doc.nameOf(object.value.get("Subtype"));
      if (type === "ObjStm" || type === "XRef" || type === "Metadata" || subtype === "Image" || object.value.has("Length1")) continue;
      const data = doc.stream(num);
      if (data) source += `${toLatin1(data)}\n`;
    }
    if (source) {
      const text = readPage(source, undefined);
      pages.push(text);
    }
  }

  const meta: string[] = [];
  const info = doc.dict(doc.trailer.get("Info"));
  for (const key of ["Title", "Author"]) {
    const value = doc.resolve(info?.get(key));
    const text = value instanceof Str ? pdfString(value.value).trim() : "";
    // Writers fill these with placeholders; a placeholder tells the reader nothing.
    if (text && !/^(?:untitled|anonymous|about:blank|unknown|unspecified)$/i.test(text)) meta.push(`${key}: ${text}`);
  }

  const readable = pages.filter((page) => page.trim().length > 0).length;
  if (readable === 0) {
    warnings.push(
      imageOnly > 0 || pages.length > 0
        ? "No text could be read. The pages look like scanned images, which need an OCR step this reader does not have."
        : "No text could be read from this PDF.",
    );
  } else if (imageOnly > 0) {
    warnings.push(`${imageOnly} page(s) have only images and no text, so they were not read.`);
  }
  if (decoded > 0 && unmapped / decoded > 0.02) {
    warnings.push("Some text uses fonts or character sets this reader cannot decode, so parts of it are missing.");
  }
  warnings.push("Text follows the order the PDF was written in. Page layout, columns, tables, and pictures are not reproduced.");
  const confidence: PdfResult["confidence"] = readable === 0 ? "low" : unmapped / Math.max(decoded, 1) > 0.05 ? "medium" : "high";
  return { pages, meta, warnings, confidence };
}
