// Decides how the bytes of an HTML or XHTML file are text: a byte order mark, then the transport's
// charset, then the document's own declaration (an XML declaration, <meta charset>, or <meta http-equiv>)
// found by scanning the start of the file the way the HTML Standard's prescan does. The Standard looks at 1,024 bytes
// and has a browser start over when a later <meta> names another encoding; this reads 64 KiB once instead. A file that
// declares nothing is read as UTF-8 when it is valid UTF-8 and as windows-1252 when it is not.
import { tokenizeHtml } from "./htmltokens";

export type EncodingSource = "bom" | "transport" | "declaration" | "utf-8" | "windows-1252";

export interface DecodedMarkup {
  text: string;
  encoding: string;
  source: EncodingSource;
}

const PRESCAN_BYTES = 65536;

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  return out;
}

/** A label as the Encoding Standard names it, or null when it names no encoding this runtime can decode. */
export function normalizeEncoding(label: string): string | null {
  try {
    return new TextDecoder(label.trim()).encoding;
  } catch {
    return null;
  }
}

function charsetFromContent(content: string): string | null {
  const match = /charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;"']+))/i.exec(content);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** The encoding a document names for itself near its start, or null. */
export function declaredEncoding(bytes: Uint8Array): string | null {
  const head = latin1(bytes.subarray(0, PRESCAN_BYTES));
  const xml = /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([^"']+)["']/i.exec(head);
  let name: string | null = xml ? normalizeEncoding(xml[1]) : null;
  if (name === null) {
    tokenizeHtml(head, (token) => {
      if (name !== null || token.type !== "start" || token.name !== "meta") return;
      const attr = (key: string): string | undefined => token.attrs.find(([k]) => k === key)?.[1];
      const label = attr("charset") ?? (attr("http-equiv")?.toLowerCase() === "content-type" ? charsetFromContent(attr("content") ?? "") : null);
      // A label that names no encoding is skipped and the scan goes on.
      if (label) name = normalizeEncoding(label);
    }, { autoSwitch: false });
  }
  if (name === null) return null;
  // The Standard reads a UTF-16 declaration found by prescan as UTF-8, because a prescan that succeeded was ASCII-compatible.
  if (name === "utf-16le" || name === "utf-16be") return "utf-8";
  return name === "x-user-defined" ? "windows-1252" : name;
}

export function decodeMarkup(bytes: Uint8Array, transportCharset?: string): DecodedMarkup {
  const decode = (encoding: string, skip: number, source: EncodingSource): DecodedMarkup => ({
    text: new TextDecoder(encoding).decode(bytes.subarray(skip)),
    encoding,
    source,
  });
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decode("utf-8", 3, "bom");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode("utf-16be", 2, "bom");
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode("utf-16le", 2, "bom");
  const transport = transportCharset ? normalizeEncoding(transportCharset) : null;
  if (transport) return decode(transport, 0, "transport");
  const declared = declaredEncoding(bytes);
  if (declared) return decode(declared, 0, "declaration");
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", source: "utf-8" };
  } catch {
    return decode("windows-1252", 0, "windows-1252");
  }
}

/** The charset parameter of a Content-Type value, if it has one. */
export function charsetOf(contentType: string): string | undefined {
  return /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
}
