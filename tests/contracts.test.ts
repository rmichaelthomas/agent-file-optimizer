import { describe, expect, it } from "vitest";
import { createTokenPair, hashToken } from "../src/crypto";
import { normalizeRelativePath } from "../src/path";
import { MemoryBlobStore } from "../src/storage";
import { MemoryWorkspaceStore } from "../src/store";
import { getParserCapabilities, isWorkspaceWindowHours } from "../src/parsers/types";

describe("workspace contracts", () => {
  it("accepts only the promised retention windows", () => {
    expect(isWorkspaceWindowHours(1)).toBe(true);
    expect(isWorkspaceWindowHours(6)).toBe(true);
    expect(isWorkspaceWindowHours(12)).toBe(true);
    expect(isWorkspaceWindowHours(24)).toBe(false);
  });

  it("hashes generated bearer tokens instead of storing raw values", async () => {
    const pair = await createTokenPair();
    expect(pair.uploadToken).not.toBe(pair.uploadTokenHash);
    expect(pair.shareToken).not.toBe(pair.shareTokenHash);
    expect(pair.uploadTokenHash).toBe(await hashToken(pair.uploadToken));
    expect(pair.shareTokenHash).toBe(await hashToken(pair.shareToken));
  });

  it("rejects traversal and normalizes browser paths", () => {
    expect(normalizeRelativePath("src\\index.ts")).toBe("src/index.ts");
    expect(normalizeRelativePath("./README.md")).toBe("README.md");
    expect(() => normalizeRelativePath("../../secret.txt")).toThrow();
    expect(() => normalizeRelativePath("/absolute.txt")).toThrow();
  });

  it("declares a multi-parser capability matrix", () => {
    const capabilities = getParserCapabilities();
    expect(capabilities.some((item) => item.id === "native-text")).toBe(true);
    expect(capabilities.some((item) => item.id === "native-json")).toBe(true);
    expect(capabilities.some((item) => item.id === "native-table")).toBe(true);
    expect(capabilities.some((item) => item.billingClass === "unsupported")).toBe(true);
  });

  it("stores files and objects through local adapters", async () => {
    const store = new MemoryWorkspaceStore();
    const blobs = new MemoryBlobStore();
    await blobs.put({ key: "w/original/a.txt", bytes: new Uint8Array([1, 2]), contentType: "text/plain" });
    expect((await blobs.get("w/original/a.txt"))?.bytes).toEqual(new Uint8Array([1, 2]));
    await blobs.deletePrefix("w/original");
    expect(await blobs.get("w/original/a.txt")).toBeNull();
    expect(await store.listNeedingPurge(new Date(0).toISOString())).toEqual([]);
  });
});
