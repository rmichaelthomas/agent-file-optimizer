import type { ExternalParserRunner, Parser, ParsedFile, ParserInput } from "./types";
import { getParserCapabilities } from "./types";
import { inflateSync, strFromU8, unzipSync, unzlibSync } from "fflate";

const decoder = new TextDecoder("utf-8");

function textFrom(bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function capability(id: string) {
  const value = getParserCapabilities().find((item) => item.id === id);
  if (!value) throw new Error(`Missing parser capability: ${id}`);
  return value;
}

function matches(input: Pick<ParserInput, "path" | "contentType">, id: string): boolean {
  const item = capability(id);
  return item.extensions.includes(extension(input.path)) || item.mimeTypes.includes(input.contentType.toLowerCase());
}

function textParser(): Parser {
  return {
    capability: capability("native-text"),
    supports: (input) => matches(input, "native-text"),
    parse: async (input): Promise<ParsedFile> => ({
      parserId: "native-text",
      billingClass: "free-native",
      confidence: "high",
      text: textFrom(input.bytes),
      jsonl: [],
      warnings: [],
    }),
  };
}

function jsonParser(): Parser {
  return {
    capability: capability("native-json"),
    supports: (input) => matches(input, "native-json"),
    parse: async (input): Promise<ParsedFile> => {
      const text = textFrom(input.bytes);
      try {
        const value: unknown = JSON.parse(text);
        const values = Array.isArray(value) ? value : [value];
        return {
          parserId: "native-json",
          billingClass: "free-native",
          confidence: "high",
          text: JSON.stringify(value, null, 2),
          jsonl: values.map((item) => JSON.stringify(item)),
          warnings: [],
        };
      } catch {
        return {
          parserId: "native-json",
          billingClass: "free-native",
          confidence: "low",
          text,
          jsonl: [],
          warnings: ["JSON parser could not parse this file; the original text was preserved."],
        };
      }
    },
  };
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length > 0 && row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushField();
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const format = (row: string[]) => `| ${row.map((cell) => cell.replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`;
  return [format(padded[0]), format(padded[0].map(() => "---")), ...padded.slice(1).map(format)].join("\n");
}

function tableParser(): Parser {
  return {
    capability: capability("native-table"),
    supports: (input) => matches(input, "native-table"),
    parse: async (input): Promise<ParsedFile> => {
      const text = textFrom(input.bytes);
      const rows = parseDelimited(text, extension(input.path) === ".tsv" || input.contentType.includes("tab-separated") ? "\t" : ",");
      const headers = rows[0] ?? [];
      const jsonl = rows.slice(1).map((row) => {
        const object: Record<string, string> = {};
        headers.forEach((header, index) => {
          object[header || `column_${index + 1}`] = row[index] ?? "";
        });
        return JSON.stringify(object);
      });
      return {
        parserId: "native-table",
        billingClass: "free-native",
        confidence: "high",
        text: markdownTable(rows),
        jsonl,
        warnings: rows.length === 0 ? ["The table contained no readable rows."] : [],
      };
    },
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlParser(): Parser {
  return {
    capability: capability("native-html"),
    supports: (input) => matches(input, "native-html"),
    parse: async (input): Promise<ParsedFile> => {
      const value = textFrom(input.bytes)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|br)\s*>/gi, "\n")
        .replace(/<[^>]+>/g, "");
      const text = decodeEntities(value)
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
      return {
        parserId: "native-html",
        billingClass: "free-native",
        confidence: "medium",
        text,
        jsonl: [],
        warnings: [],
      };
    },
  };
}

const archiveMemberLimit = 100;
const archiveBytesLimit = 25 * 1024 * 1024;
const archiveMemberBytesLimit = 10 * 1024 * 1024;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function readableXml(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\s*\/?>(?:<\/w:tab>)?/gi, "\t")
      .replace(/<\/(?:w:p|a:p|x:row|row|table:table-row)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

interface ArchiveMember {
  name: string;
  bytes: Uint8Array;
}

function boundedArchiveMembers(bytes: Uint8Array): { members: ArchiveMember[]; skipped: number } {
  let selected = 0;
  let skipped = 0;
  let totalBytes = 0;
  try {
    const unzipped = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        if (selected >= archiveMemberLimit || file.originalSize > archiveMemberBytesLimit || totalBytes + file.originalSize > archiveBytesLimit) {
          skipped += 1;
          return false;
        }
        selected += 1;
        totalBytes += file.originalSize;
        return true;
      },
    });
    const members = Object.entries(unzipped)
      .map(([name, value]) => ({ name, bytes: value }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { members, skipped };
  } catch {
    throw new Error("The ZIP package could not be safely inspected.");
  }
}

function officeKind(path: string): "docx" | "pptx" | "xlsx" | null {
  const ext = extension(path);
  return ext === ".docx" ? "docx" : ext === ".pptx" ? "pptx" : ext === ".xlsx" ? "xlsx" : null;
}

function officeMemberSelection(kind: "docx" | "pptx" | "xlsx", members: ArchiveMember[]): ArchiveMember[] {
  const selected = members.filter((member) => {
    if (!member.name.toLowerCase().endsWith(".xml")) return false;
    if (kind === "docx") return member.name === "word/document.xml" || /^word\/(?:header|footer)\d+\.xml$/i.test(member.name);
    if (kind === "pptx") return /^ppt\/slides\/slide\d+\.xml$/i.test(member.name);
    return member.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/i.test(member.name);
  });
  return selected.length > 0 ? selected : members;
}

function archiveParser(): Parser {
  return {
    capability: capability("native-archive"),
    supports: (input) => matches(input, "native-archive") || officeKind(input.path) !== null,
    parse: async (input): Promise<ParsedFile> => {
      const kind = officeKind(input.path);
      let extracted: { members: ArchiveMember[]; skipped: number };
      try {
        extracted = boundedArchiveMembers(input.bytes);
      } catch (error) {
        return {
          parserId: kind ? `native-office-${kind}` : "native-archive",
          billingClass: "free-native",
          confidence: "low",
          text: null,
          jsonl: [],
          warnings: [error instanceof Error ? error.message : "The archive could not be safely inspected; the original was preserved."],
        };
      }

      const members = kind ? officeMemberSelection(kind, extracted.members) : extracted.members;
      const sections: string[] = [];
      const jsonl: string[] = [];
      const warnings: string[] = [];
      for (const member of members) {
        let memberPath: string;
        try {
          memberPath = normalizeArchiveMember(member.name);
        } catch {
          warnings.push(`Skipped unsafe archive member path: ${member.name}`);
          continue;
        }
        let parsed: ParsedFile;
        if (kind) {
          const xml = readableXml(strFromU8(member.bytes));
          parsed = { parserId: `native-office-${kind}`, billingClass: "free-native", confidence: "medium", text: xml, jsonl: [], warnings: [] };
        } else {
          parsed = await parseWithBestParser({ path: memberPath, contentType: "application/octet-stream", bytes: member.bytes }, { allowArchive: false });
        }
        if (parsed.text !== null) {
          sections.push(`### ${memberPath}\n\n${parsed.text}`);
          jsonl.push(JSON.stringify({ path: memberPath, text: parsed.text }));
        }
        if (parsed.jsonl.length > 0) {
          for (const line of parsed.jsonl) {
            try {
              jsonl.push(JSON.stringify({ path: memberPath, data: JSON.parse(line) }));
            } catch {
              jsonl.push(JSON.stringify({ path: memberPath, data: line }));
            }
          }
        }
        warnings.push(...parsed.warnings.map((warning) => `${memberPath}: ${warning}`));
      }
      if (extracted.skipped > 0) warnings.push(`${extracted.skipped} archive member(s) were omitted by safety limits.`);
      if (sections.length === 0) warnings.push("The archive contained no readable text members; the original was preserved.");
      return {
        parserId: kind ? `native-office-${kind}` : "native-archive",
        billingClass: "free-native",
        confidence: sections.length > 0 ? "high" : "low",
        text: sections.length > 0 ? `# ${kind ? kind.toUpperCase() : "Archive"} contents\n\n${sections.join("\n\n")}` : null,
        jsonl,
        warnings,
      };
    },
  };
}

function normalizeArchiveMember(path: string): string {
  const cleaned = path.replaceAll("\\", "/");
  if (cleaned.startsWith("/") || cleaned.split("/").includes("..")) throw new Error("Unsafe archive member path");
  return cleaned;
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_match, code: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[code] ?? code)
    .replace(/\\([0-7]{1,3})/g, (_match, code: string) => String.fromCharCode(parseInt(code, 8)));
}

function pdfLiteralStrings(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/\(((?:\\.|[^()])*)\)\s*Tj/g)) values.push(decodePdfLiteral(match[1]));
  for (const match of text.matchAll(/\[([^\]]*)\]\s*TJ/gi)) {
    for (const literal of match[1].matchAll(/\(((?:\\.|[^()])*)\)/g)) values.push(decodePdfLiteral(literal[1]));
  }
  return values;
}

function pdfParser(): Parser {
  return {
    capability: capability("native-pdf-basic"),
    supports: (input) => matches(input, "native-pdf-basic"),
    parse: async (input): Promise<ParsedFile> => {
      const latin1 = new TextDecoder("latin1").decode(input.bytes);
      const contents = [latin1];
      let cursor = 0;
      while (true) {
        const streamStart = latin1.indexOf("stream", cursor);
        if (streamStart < 0) break;
        const dataStart = latin1[streamStart + 6] === "\r" && latin1[streamStart + 7] === "\n" ? streamStart + 8 : streamStart + 7;
        const dataEnd = latin1.indexOf("endstream", dataStart);
        if (dataEnd < 0) break;
        if (/\/FlateDecode/i.test(latin1.slice(Math.max(0, streamStart - 200), streamStart))) {
          const compressed = input.bytes.slice(dataStart, dataEnd);
          try {
            contents.push(new TextDecoder("latin1").decode(unzlibSync(compressed)));
          } catch {
            try { contents.push(new TextDecoder("latin1").decode(inflateSync(compressed))); } catch { /* keep scanning literal source */ }
          }
        }
        cursor = dataEnd + 9;
      }
      const text = pdfLiteralStrings(contents.join("\n")).join("\n").trim();
      return {
        parserId: "native-pdf-basic",
        billingClass: "free-native",
        confidence: text ? "medium" : "low",
        text: text || null,
        jsonl: text ? [JSON.stringify({ text })] : [],
        warnings: text ? ["Basic PDF extraction preserves literal text but may miss complex layout, scanned pages, and embedded fonts."] : ["PDF basic parser found no readable literal text; the original was preserved. Complex or scanned PDFs need the optional document parser runner."],
      };
    },
  };
}

function fallbackParser(): Parser {
  return {
    capability: capability("fallback-original-only"),
    supports: () => true,
    parse: async (): Promise<ParsedFile> => ({
      parserId: "fallback-original-only",
      billingClass: "unsupported",
      confidence: "low",
      text: null,
      jsonl: [],
      warnings: ["No parser is configured for this format yet; the original file was preserved."],
    }),
  };
}

const parsers = [jsonParser(), tableParser(), htmlParser(), pdfParser(), archiveParser(), textParser(), fallbackParser()];

export function getNativeParsers(): Parser[] {
  return [...parsers];
}

export async function parseWithBestParser(input: ParserInput, options: { allowArchive?: boolean; allowExternal?: boolean; externalRunner?: ExternalParserRunner } = {}): Promise<ParsedFile> {
  if (options.allowExternal && options.externalRunner?.supports(input)) {
    try {
      const parsed = await options.externalRunner.parse(input);
      return { ...parsed, parserId: parsed.parserId || options.externalRunner.id, billingClass: "external" };
    } catch (error) {
      return {
        parserId: options.externalRunner.id,
        billingClass: "external",
        confidence: "low",
        text: null,
        jsonl: [],
        warnings: [error instanceof Error ? `External parser failed: ${error.message}` : "External parser failed; the original was preserved."],
      };
    }
  }
  const candidates = options.allowArchive === false ? parsers.filter((parser) => parser.capability.id !== "native-archive" && !parser.capability.id.startsWith("native-office-")) : parsers;
  const parser = candidates.find((candidate) => candidate.supports(input)) ?? candidates[candidates.length - 1];
  return parser.parse(input);
}
