import type { ExternalParserRunner, ParsedFile, ParserInput } from "./types";

export interface SandboxProcess {
  output(options?: { encoding?: "utf8" }): Promise<{ stdout: string; exitCode: number | null }>;
}

export interface SandboxLike {
  writeFile(path: string, content: string, options?: { encoding?: "base64" }): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exec(argv: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<SandboxProcess>;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function basename(path: string): string {
  const value = path.split("/").pop() ?? "input.bin";
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

const markItDownScript = [
  "import json, sys",
  "from markitdown import MarkItDown",
  "result = MarkItDown().convert(sys.argv[1])",
  "print(json.dumps({'text': result.text_content}))",
].join("; ");

export class SandboxCommandParserRunner implements ExternalParserRunner {
  readonly id = "sandbox-markitdown";
  readonly billingClass = "external" as const;

  constructor(private readonly sandbox: SandboxLike) {}

  supports(input: Pick<ParserInput, "path" | "contentType">): boolean {
    return /\.(pdf|docx|pptx|xlsx|odt|ods|odp|rtf)$/i.test(input.path) || input.contentType.startsWith("image/");
  }

  async parse(input: ParserInput): Promise<ParsedFile> {
    const sandboxPath = `/workspace/${basename(input.path)}`;
    try {
      await this.sandbox.writeFile(sandboxPath, base64(input.bytes), { encoding: "base64" });
      const process = await this.sandbox.exec(["python3", "-c", markItDownScript, sandboxPath], { cwd: "/workspace" });
      const output = await process.output({ encoding: "utf8" });
      if (output.exitCode !== 0) throw new Error("MarkItDown exited without a result.");
      const result: unknown = JSON.parse(output.stdout);
      const text = result !== null && typeof result === "object" && "text" in result && typeof result.text === "string" ? result.text : null;
      if (text === null) throw new Error("MarkItDown returned no text projection.");
      return {
        parserId: this.id,
        billingClass: "external",
        confidence: "medium",
        text,
        jsonl: [],
        warnings: ["Optional Sandbox/MarkItDown processing was explicitly enabled for this file; provider/runtime cost may apply."],
      };
    } catch (error) {
      return {
        parserId: this.id,
        billingClass: "external",
        confidence: "low",
        text: null,
        jsonl: [],
        warnings: [error instanceof Error ? `Optional document runner failed: ${error.message}` : "Optional document runner failed; the original was preserved."],
      };
    } finally {
      await this.sandbox.deleteFile(sandboxPath).catch(() => undefined);
    }
  }
}
