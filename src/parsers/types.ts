import type { BillingClass } from "../types";

export interface ParserCapability {
  id: string;
  label: string;
  billingClass: BillingClass;
  extensions: string[];
  mimeTypes: string[];
  notes: string;
}

export interface ParsedFile {
  parserId: string;
  billingClass: BillingClass;
  confidence: "high" | "medium" | "low";
  text: string | null;
  jsonl: string[];
  warnings: string[];
}

export interface ParserInput {
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface Parser {
  capability: ParserCapability;
  supports(input: Pick<ParserInput, "path" | "contentType">): boolean;
  parse(input: ParserInput): Promise<ParsedFile>;
}

/**
 * An explicitly enabled parser that may run outside the Worker isolate.
 * Keeping this contract separate from Parser makes the free/native default
 * impossible to change accidentally when a richer runner is added.
 */
export interface ExternalParserRunner {
  id: string;
  billingClass: "external";
  supports(input: Pick<ParserInput, "path" | "contentType">): boolean;
  parse(input: ParserInput): Promise<ParsedFile>;
}

export function isWorkspaceWindowHours(value: unknown): value is 1 | 6 | 12 {
  return value === 1 || value === 6 || value === 12;
}

export function getParserCapabilities(): ParserCapability[] {
  return [
    {
      id: "native-text",
      label: "Text, Markdown, and code",
      billingClass: "free-native",
      extensions: [".txt", ".md", ".markdown", ".rst", ".log", ".ts", ".tsx", ".js", ".jsx", ".jsonc", ".css", ".html", ".mjs", ".cjs", ".mts", ".cts", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".sh", ".bash", ".zsh", ".sql", ".toml", ".ini", ".cfg", ".conf", ".yaml", ".yml", ".env", ".gitignore", ".scss", ".vue", ".svelte", ".lua", ".r", ".pl"],
      mimeTypes: ["text/plain", "text/markdown", "text/css", "application/javascript"],
      notes: "Preserves readable text without sending it to an external parser. A file with an unlisted extension is also read as text when its bytes are valid UTF-8 with no NUL bytes.",
    },
    {
      id: "native-json",
      label: "JSON",
      billingClass: "free-native",
      extensions: [".json"],
      mimeTypes: ["application/json"],
      notes: "Normalizes valid JSON and emits one JSON record per line.",
    },
    {
      id: "native-table",
      label: "CSV and TSV tables",
      billingClass: "free-native",
      extensions: [".csv", ".tsv"],
      mimeTypes: ["text/csv", "text/tab-separated-values"],
      notes: "Preserves rows as JSONL and a readable Markdown table.",
    },
    {
      id: "native-pdf-basic",
      label: "Basic PDF text",
      billingClass: "free-native",
      extensions: [".pdf"],
      mimeTypes: ["application/pdf"],
      notes: "Extracts literal text operators and simple Flate streams; complex layout PDFs need the optional document runner.",
    },
    {
      id: "native-archive",
      label: "ZIP and project archives",
      billingClass: "free-native",
      extensions: [".zip"],
      mimeTypes: ["application/zip", "application/x-zip-compressed"],
      notes: "Lists safe, bounded archive members and parses readable members locally.",
    },
    {
      id: "native-office-docx",
      label: "DOCX text",
      billingClass: "free-native",
      extensions: [".docx"],
      mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      notes: "Extracts readable text from the document XML package.",
    },
    {
      id: "native-office-pptx",
      label: "PPTX text",
      billingClass: "free-native",
      extensions: [".pptx"],
      mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      notes: "Extracts readable text from slide XML packages.",
    },
    {
      id: "native-office-xlsx",
      label: "XLSX cell text",
      billingClass: "free-native",
      extensions: [".xlsx"],
      mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      notes: "Extracts readable cell and shared-string XML; formula evaluation is not performed.",
    },
    {
      id: "native-html",
      label: "Basic HTML",
      billingClass: "free-native",
      extensions: [".htm", ".html"],
      mimeTypes: ["text/html"],
      notes: "Removes scripts and markup for a compact text projection.",
    },
    {
      id: "fallback-original-only",
      label: "Original-only fallback",
      billingClass: "unsupported",
      extensions: ["*"],
      mimeTypes: ["*/*"],
      notes: "Keeps the original and explains that no parser is configured yet.",
    },
  ];
}
