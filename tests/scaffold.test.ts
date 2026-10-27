import { describe, expect, it } from "vitest";
import { memoryEnv } from "./helpers";

describe("MVP scaffold", () => {
  it("provides a memory environment for local tests", () => {
    expect(memoryEnv().APP_ENV).toBe("test");
    expect(memoryEnv().APP_BASE_URL).toBe("https://optimizer.test");
  });
});
