import type { ExternalParserRunner, Parser, ParsedFile, ParserInput } from "./types";
import { getParserCapabilities } from "./types";
import { inflateSync, strFromU8, unzipSync, unzlibSync } from "fflate";
import { readDocx, readPptx, readXlsx, type OfficeResult } from "./office";
import { readPdf, type PdfResult } from "./pdf";
import { readHtml, type HtmlRead } from "./html";
import { readEpub, type EpubResult } from "./epub";

const decoder = new TextDecoder("utf-8");

function textFrom(bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/** True when the bytes read as UTF-8 text: valid UTF-8 and no NUL byte. Lets an unlisted extension (a Makefile, a .proto, a new language) through as text instead of original-only. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  if (bytes.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
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

function htmlParser(): Parser {
  return {
    capability: capability("native-html"),
    supports: (input) => matches(input, "native-html"),
    parse: async (input): Promise<ParsedFile> => {
      let read: HtmlRead;
      try {
        read = readHtml(input.bytes, input.contentType);
      } catch (error) {
        return {
          parserId: "native-html",
          billingClass: "free-native",
          confidence: "low",
          text: null,
          jsonl: [],
          warnings: [error instanceof Error && /too many elements/.test(error.message) ? error.message : "This page could not be read safely; the original was preserved."],
        };
      }
      return {
        parserId: "native-html",
        billingClass: "free-native",
        confidence: read.text.trim().length > 0 ? "high" : "low",
        text: read.text,
        jsonl: [],
        warnings: read.warnings,
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

function boundedArchiveMembers(bytes: Uint8Array, include?: (name: string) => boolean): { members: ArchiveMember[]; skipped: number } {
  let selected = 0;
  let skipped = 0;
  let totalBytes = 0;
  try {
    const unzipped = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        if (include && !include(file.name)) return false;
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
        // An Office package is mostly pictures and fonts. Only its XML parts are read, so the member limit is not spent on media.
        extracted = boundedArchiveMembers(input.bytes, kind ? (name) => /\.(?:xml|rels)$/i.test(name) : undefined);
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

      const sections: string[] = [];
      const jsonl: string[] = [];
      const warnings: string[] = [];
      if (kind) {
        let result: OfficeResult | null = null;
        try {
          const files = new Map(extracted.members.map((member) => [member.name, member.bytes] as const));
          result = kind === "docx" ? readDocx(files) : kind === "pptx" ? readPptx(files) : readXlsx(files);
        } catch {
          result = null;
        }
        if (result) {
          return {
            parserId: `native-office-${kind}`,
            billingClass: "free-native",
            confidence: "high",
            text: result.text,
            jsonl: result.jsonl,
            warnings: [...result.warnings, ...(extracted.skipped > 0 ? [`${extracted.skipped} package part(s) were omitted by safety limits.`] : [])],
          };
        }
        warnings.push("The document's structure could not be read, so its raw text content is shown instead.");
      }
      const members = kind ? officeMemberSelection(kind, extracted.members) : extracted.members;
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

function epubParser(): Parser {
  return {
    capability: capability("native-epub"),
    supports: (input) => matches(input, "native-epub"),
    parse: async (input): Promise<ParsedFile> => {
      let result: EpubResult;
      try {
        result = readEpub(input.bytes);
      } catch (error) {
        return {
          parserId: "native-epub",
          billingClass: "free-native",
          confidence: "low",
          text: null,
          jsonl: [],
          warnings: [error instanceof Error ? error.message : "This book could not be read safely; the original was preserved."],
        };
      }
      return { parserId: "native-epub", billingClass: "free-native", confidence: "high", text: result.text, jsonl: result.jsonl, warnings: result.warnings };
    },
  };
}

function pdfParser(): Parser {
  return {
    capability: capability("native-pdf"),
    supports: (input) => matches(input, "native-pdf"),
    parse: async (input): Promise<ParsedFile> => {
      let result: PdfResult;
      try {
        result = readPdf(input.bytes);
      } catch (error) {
        return {
          parserId: "native-pdf",
          billingClass: "free-native",
          confidence: "low",
          text: null,
          jsonl: [],
          warnings: [error instanceof Error && /too large|larger than/.test(error.message) ? error.message : "This PDF could not be read safely; the original was preserved."],
        };
      }
      const readable = result.pages.filter((page) => page.trim().length > 0);
      const outlineLines = result.outline.slice(0, 150).map((entry) => `${"  ".repeat(Math.min(entry.depth, 6))}- ${entry.title}${entry.page ? ` (page ${entry.page})` : ""}`);
      if (result.outline.length > 150) outlineLines.push(`- (+${result.outline.length - 150} more)`);
      const text = readable.length > 0
        ? [...(result.meta.length > 0 ? [result.meta.join("\n")] : []), ...(result.outline.length >= 2 ? [`Contents (the PDF's own outline):\n${outlineLines.join("\n")}`] : []), ...result.pages.map((page, index) => (page.trim() ? (result.pages.length > 1 ? `### Page ${index + 1}\n\n${page}` : page) : "")).filter(Boolean)].join("\n\n")
        : null;
      return {
        parserId: "native-pdf",
        billingClass: "free-native",
        confidence: result.confidence,
        text,
        jsonl: result.pages.map((page, index) => JSON.stringify({ page: index + 1, text: page })).filter((_line, index) => result.pages[index].trim().length > 0),
        warnings: result.warnings,
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

const parsers = [jsonParser(), tableParser(), htmlParser(), pdfParser(), epubParser(), archiveParser(), textParser(), fallbackParser()];

export function getNativeParsers(): Parser[] {
  return [...parsers];
}

const documentExtensions = new Set([".pdf", ".docx", ".pptx", ".xlsx", ".zip", ".epub"]);

export async function parseWithBestParser(input: ParserInput, options: { allowArchive?: boolean; allowDocuments?: boolean; allowExternal?: boolean; externalRunner?: ExternalParserRunner } = {}): Promise<ParsedFile> {
  if (options.allowDocuments === false && (documentExtensions.has(extension(input.path)) || /pdf|zip|officedocument|epub/i.test(input.contentType)) && !options.externalRunner?.supports(input)) {
    return {
      parserId: "fallback-original-only",
      billingClass: "unsupported",
      confidence: "low",
      text: null,
      jsonl: [],
      warnings: ["Reading PDFs, Office files, and ZIP archives is turned off on this deployment (DOCUMENT_READING=off), so the original was preserved."],
    };
  }
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
  const fallback = candidates[candidates.length - 1];
  const matched = candidates.slice(0, -1).find((candidate) => candidate.supports(input));
  const parser = matched ?? (looksLikeText(input.bytes) ? candidates.find((candidate) => candidate.capability.id === "native-text") : undefined) ?? fallback;
  return parser.parse(input);
}
