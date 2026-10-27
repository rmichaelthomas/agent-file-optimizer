import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { SCHEMA_STATEMENTS, ensureSchema } from "../src/schema";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import { memoryEnv } from "./helpers";

// A D1 stand-in that records what it was asked to run and can be told to fail once.
function fakeDb(options: { failFirstBatch?: boolean } = {}) {
  const batches: string[][] = [];
  let failNext = options.failFirstBatch ?? false;
  const db = {
    prepare: (sql: string) => ({ sql }),
    batch: async (statements: { sql: string }[]) => {
      if (failNext) {
        failNext = false;
        throw new Error("D1 unavailable");
      }
      batches.push(statements.map((statement) => statement.sql));
      return [];
    },
  };
  return { db: db as unknown as D1Database, batches };
}

describe("schema bootstrap", () => {
  it("creates every table and index in one idempotent batch", async () => {
    const { db, batches } = fakeDb();
    await ensureSchema(db);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(SCHEMA_STATEMENTS);
    expect(batches[0].every((sql) => sql.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("runs once per database and skips later requests", async () => {
    const { db, batches } = fakeDb();
    await Promise.all([ensureSchema(db), ensureSchema(db)]);
    await ensureSchema(db);
    expect(batches).toHaveLength(1);
  });

  it("forgets a failed check so the next request retries it", async () => {
    const { db, batches } = fakeDb({ failFirstBatch: true });
    await expect(ensureSchema(db)).rejects.toThrow("D1 unavailable");
    await ensureSchema(db);
    expect(batches).toHaveLength(1);
  });

  it("includes the purge column the cleanup relies on", () => {
    const workspaces = SCHEMA_STATEMENTS.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workspaces")) ?? "";
    expect(workspaces).toContain("purged_at TEXT");
  });
});

describe("admin token gate", () => {
  const services = () => ({ store: new MemoryWorkspaceStore(), blobs: new MemoryBlobStore() });
  const create = (env: Parameters<typeof memoryEnv>[0]) =>
    createApp(memoryEnv(env), services()).fetch(
      new Request("https://optimizer.test/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }),
      }),
    );

  it("refuses to create workspaces when ADMIN_TOKEN is set but blank", async () => {
    const response = await create({ ADMIN_TOKEN: "" });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("ADMIN_TOKEN is set but empty");
  });

  it("stays open for local use when ADMIN_TOKEN is not defined at all", async () => {
    const response = await create({});
    expect(response.status).toBe(201);
  });

  it("requires the token when one is set", async () => {
    const response = await create({ ADMIN_TOKEN: "a-long-random-value" });
    expect(response.status).toBe(401);
  });
});
