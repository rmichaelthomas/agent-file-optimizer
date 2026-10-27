import { describe, expect, it } from "vitest";
import { basicSafetyCheck } from "../src/safety";

describe("basic safety preflight", () => {
  it("labels ordinary text as a heuristic pass, not a malware verdict", () => {
    const result = basicSafetyCheck("notes.md", "text/markdown", new TextEncoder().encode("hello"));
    expect(result.status).toBe("basic-check-passed");
    expect(result.scanner).toBe("basic-heuristics-only");
    expect(result.disclaimer).toMatch(/not a malware verdict/i);
  });

  it("flags executable extensions and Office macro payload markers", () => {
    const result = basicSafetyCheck("tool.exe", "application/octet-stream", new TextEncoder().encode("vbaProject.bin"));
    expect(result.status).toBe("basic-check-warning");
    expect(result.signals.join(" ")).toMatch(/executable|macro/i);
  });
});
