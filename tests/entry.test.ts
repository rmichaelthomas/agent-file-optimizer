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

describe("rate limiting", () => {
  const limiter = (allow: boolean, seen: string[] = []) => ({
    limit: async ({ key }: { key: string }) => {
      seen.push(key);
      return { success: allow };
    },
  });
  const call = (path: string, env: Record<string, unknown>, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://x.test${path}`, { headers }), env, {} as ExecutionContext);

  it("answers 429 with retry-after when the caller is over the limit", async () => {
    const response = await call("/s/anything", { RATE_LIMITER: limiter(false) });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("keys the counter by route class and caller, and leaves the landing page and health check alone", async () => {
    const seen: string[] = [];
    const env = { RATE_LIMITER: limiter(false, seen) };
    expect((await call("/", env)).status).toBe(200);
    expect((await call("/healthz", env)).status).toBe(200);
    expect(seen).toEqual([]);
    await call("/api/capabilities", env, { "cf-connecting-ip": "203.0.113.7" });
    await call("/s/token", env, { "cf-connecting-ip": "203.0.113.7" });
    expect(seen).toEqual(["api:203.0.113.7", "share:203.0.113.7"]);
  });

  it("lets requests through when under the limit or when no limiter is bound", async () => {
    expect((await call("/api/capabilities", { RATE_LIMITER: limiter(true) })).status).toBe(200);
    expect((await call("/api/capabilities", {})).status).toBe(200);
  });
});
