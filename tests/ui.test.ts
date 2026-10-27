import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { renderLandingPage } from "../src/ui";

describe("landing page", () => {
  it("explains the non-technical workflow and retention choices", () => {
    const html = renderLandingPage();
    expect(html).toContain("Drop files here");
    expect(html).toContain("webkitdirectory");
    expect(html).toContain("public GitHub repository");
    expect(html).toContain("1 hour");
    expect(html).toContain("6 hours");
    expect(html).toContain("12 hours");
    expect(html).toContain("no external parser is called");
    expect(html).toContain("navigator.clipboard");
  });
});

describe("landing page headers", () => {
  it("refuses framing and content sniffing", async () => {
    const response = await worker.fetch(new Request("https://x.test/"), {}, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
