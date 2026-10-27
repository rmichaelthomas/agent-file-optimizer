import { describe, expect, it } from "vitest";
import { SandboxCommandParserRunner, type SandboxLike } from "../src/parsers/sandbox-runner";

describe("optional sandbox parser runner", () => {
  it("uses argv and isolated files without placing credentials in the sandbox", async () => {
    const calls: string[][] = [];
    const sandbox: SandboxLike = {
      async writeFile() { return undefined; },
      async deleteFile() { return undefined; },
      async exec(argv) {
        calls.push(argv);
        return { async output() { return { stdout: JSON.stringify({ text: "sandbox text" }), exitCode: 0 }; } };
      },
    };
    const runner = new SandboxCommandParserRunner(sandbox);
    const parsed = await runner.parse({ path: "brief.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(parsed.parserId).toBe("sandbox-markitdown");
    expect(parsed.billingClass).toBe("external");
    expect(parsed.text).toBe("sandbox text");
    expect(calls[0][0]).toBe("python3");
    expect(calls[0]).not.toContain("sh");
  });
});
