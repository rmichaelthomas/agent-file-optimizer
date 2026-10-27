import { describe, expect, it } from "vitest";
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
