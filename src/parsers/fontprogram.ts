// Reads the built-in encoding of an embedded font program, which says which character each code draws
// when the PDF gives the font no encoding of its own. That is how many TeX and Ghostscript PDFs store
// the "fi" and "fl" ligatures and accented letters. Only the encoding is read, never the outlines.
import { CFF_STANDARD_STRINGS, STANDARD_ENCODING } from "./glyphs";

export type BuiltinEncoding = Map<number, string> | "standard";

function toText(bytes: Uint8Array, limit = bytes.length): string {
  let out = "";
  const end = Math.min(limit, bytes.length);
  for (let i = 0; i < end; i += 8192) out += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, end)));
  return out;
}

/** Type 1 (FontFile): the clear-text part lists the encoding as `dup 140 /fi put` lines. */
export function type1Encoding(data: Uint8Array): BuiltinEncoding | null {
  const text = toText(data, 65536);
  const eexec = text.indexOf("eexec");
  const head = eexec >= 0 ? text.slice(0, eexec) : text;
  if (/\/Encoding\s+StandardEncoding\s+def/.test(head)) return "standard";
  const map = new Map<number, string>();
  for (const match of head.matchAll(/dup\s+(\d+)\s*\/([^\s/]+)\s+put/g)) map.set(Number(match[1]), match[2]);
  return map.size > 0 ? map : null;
}

interface Index {
  items: Uint8Array[];
  end: number;
}

function readIndex(data: Uint8Array, offset: number): Index | null {
  if (offset + 2 > data.length) return null;
  const count = (data[offset] << 8) | data[offset + 1];
  if (count === 0) return { items: [], end: offset + 2 };
  const offSize = data[offset + 2];
  if (offSize < 1 || offSize > 4) return null;
  const readOffset = (i: number): number => {
    let value = 0;
    for (let b = 0; b < offSize; b += 1) value = value * 256 + data[offset + 3 + i * offSize + b];
    return value;
  };
  const base = offset + 3 + (count + 1) * offSize - 1;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = base + readOffset(i);
    const end = base + readOffset(i + 1);
    if (start < 0 || end > data.length || end < start) return null;
    items.push(data.subarray(start, end));
  }
  return { items, end: base + readOffset(count) };
}

function readDict(bytes: Uint8Array): Map<number, number[]> {
  const dict = new Map<number, number[]>();
  let operands: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    if (b0 <= 21) {
      let op = b0;
      i += 1;
      if (b0 === 12) {
        op = 1200 + bytes[i];
        i += 1;
      }
      dict.set(op, operands);
      operands = [];
    } else if (b0 === 28) {
      operands.push(((bytes[i + 1] << 8) | bytes[i + 2]) << 16 >> 16);
      i += 3;
    } else if (b0 === 29) {
      operands.push((bytes[i + 1] << 24) | (bytes[i + 2] << 16) | (bytes[i + 3] << 8) | bytes[i + 4]);
      i += 5;
    } else if (b0 === 30) {
      i += 1;
      let done = false;
      while (!done && i < bytes.length) {
        const byte = bytes[i];
        i += 1;
        if ((byte & 0x0f) === 0x0f || (byte >> 4) === 0x0f) done = true;
      }
      operands.push(0);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + bytes[i + 1] + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - bytes[i + 1] - 108);
      i += 2;
    } else {
      i += 1;
    }
  }
  return dict;
}

/** CFF (FontFile3, Type1C): glyph names from the charset, codes from the Encoding table. */
export function cffEncoding(data: Uint8Array): BuiltinEncoding | null {
  if (data.length < 4 || data[0] !== 1) return null;
  const nameIndex = readIndex(data, data[2]);
  if (!nameIndex) return null;
  const topIndex = readIndex(data, nameIndex.end);
  if (!topIndex || topIndex.items.length === 0) return null;
  const stringIndex = readIndex(data, topIndex.end);
  if (!stringIndex) return null;
  const top = readDict(topIndex.items[0]);
  if (top.has(1230)) return null; // a CID-keyed font has no code-to-name encoding
  const sidName = (sid: number): string => (sid < CFF_STANDARD_STRINGS.length ? CFF_STANDARD_STRINGS[sid] : toText(stringIndex.items[sid - CFF_STANDARD_STRINGS.length] ?? new Uint8Array()));

  const charStringsOffset = top.get(17)?.[0];
  const charStrings = charStringsOffset ? readIndex(data, charStringsOffset) : null;
  if (!charStrings) return null;
  const glyphCount = charStrings.items.length;

  const charsetOffset = top.get(15)?.[0] ?? 0;
  const glyphNames: string[] = [".notdef"];
  if (charsetOffset === 0) {
    for (let gid = 1; gid < glyphCount; gid += 1) glyphNames.push(sidName(gid));
  } else if (charsetOffset > 2) {
    const format = data[charsetOffset];
    let pos = charsetOffset + 1;
    if (format === 0) {
      for (let gid = 1; gid < glyphCount && pos + 1 < data.length; gid += 1) {
        glyphNames.push(sidName((data[pos] << 8) | data[pos + 1]));
        pos += 2;
      }
    } else if (format === 1 || format === 2) {
      while (glyphNames.length < glyphCount && pos + 2 < data.length) {
        const first = (data[pos] << 8) | data[pos + 1];
        let left: number;
        if (format === 1) {
          left = data[pos + 2];
          pos += 3;
        } else {
          left = (data[pos + 2] << 8) | data[pos + 3];
          pos += 4;
        }
        for (let k = 0; k <= left && glyphNames.length < glyphCount; k += 1) glyphNames.push(sidName(first + k));
      }
    } else return null;
  } else return null;

  const encodingOffset = top.get(16)?.[0] ?? 0;
  if (encodingOffset === 0) return "standard";
  if (encodingOffset === 1) return null;
  const map = new Map<number, string>();
  const format = data[encodingOffset];
  let pos = encodingOffset + 1;
  if ((format & 0x7f) === 0) {
    const count = data[pos];
    pos += 1;
    for (let i = 0; i < count; i += 1) {
      const name = glyphNames[i + 1];
      if (name) map.set(data[pos + i], name);
    }
    pos += count;
  } else if ((format & 0x7f) === 1) {
    const ranges = data[pos];
    pos += 1;
    let gid = 1;
    for (let r = 0; r < ranges; r += 1) {
      const first = data[pos];
      const left = data[pos + 1];
      pos += 2;
      for (let k = 0; k <= left; k += 1) {
        const name = glyphNames[gid];
        if (name) map.set(first + k, name);
        gid += 1;
      }
    }
  } else return null;
  if (format & 0x80) {
    const supplements = data[pos];
    pos += 1;
    for (let i = 0; i < supplements; i += 1) {
      map.set(data[pos], sidName((data[pos + 1] << 8) | data[pos + 2]));
      pos += 3;
    }
  }
  return map.size > 0 ? map : null;
}

export function standardEncodingName(code: number): string | undefined {
  return STANDARD_ENCODING[code] || undefined;
}
