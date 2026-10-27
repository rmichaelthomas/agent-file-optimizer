import { describe, expect, it } from "vitest";
import worker from "../src/index";

const run = (path: string) => worker.fetch(new Request(`https://x.test${path}`), {}, {} as ExecutionContext);

describe("Worker entry", () => {
  it("serves the landing page as HTML", async () => {
    const response = await run("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("answers the health check", async () => {
    const response = await run("/healthz");
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("returns JSON 404 for an unknown route", async () => {
    const response = await run("/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("json");
  });
});
