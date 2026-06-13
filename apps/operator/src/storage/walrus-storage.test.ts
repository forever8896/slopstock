/**
 * Integration tests for WalrusStorage (real Walrus testnet — no mocks).
 *
 * These tests are deliberately integration-real: they hit the public Walrus
 * testnet publishers and aggregators. They verify:
 *   1. JSON roundtrip through the OgStorageClient interface
 *   2. Binary roundtrip (arbitrary bytes) through the interface
 *   3. The STORAGE_BACKEND env switch defaults to "walrus"
 *
 * Run: bun test apps/operator/src/storage/walrus-storage.test.ts
 * (takes 2–6s per test against the network)
 */

import { describe, expect, test } from "bun:test";
import { getStorageBackend } from "./storage-backend.ts";
import { WalrusStorage } from "./walrus-storage.ts";
import type { OgStorageClient } from "@stratum/shared";

// These tests hit a real network endpoint — bump timeout to 30 s
const TIMEOUT_MS = 30_000;

describe("WalrusStorage: OgStorageClient JSON roundtrip", () => {
  test(
    "pinJson → fetchJson returns identical object",
    async () => {
      const storage: OgStorageClient = new WalrusStorage();
      const obj = {
        hello: "walrus",
        nested: { numbers: [1, 2, 3] },
        ts: Date.now(),
      };
      const result = await storage.pinJson(obj);
      expect(result.realPin).toBe(true);
      expect(result.rootHash).toBeTruthy();
      expect(result.uri).toMatch(/^0g-storage:\/\//);
      expect(result.size).toBeGreaterThan(0);

      const back = await storage.fetchJson(result.rootHash);
      expect(back).toEqual(obj);
    },
    TIMEOUT_MS,
  );

  test(
    "pinText → fetchText returns identical string",
    async () => {
      const storage: OgStorageClient = new WalrusStorage();
      const content = `Hello Walrus! ts=${Date.now()}\nLine two.\n`;
      const result = await storage.pinText(content, "text/plain");
      expect(result.realPin).toBe(true);

      const back = await storage.fetchText(result.rootHash);
      expect(back).toBe(content);
    },
    TIMEOUT_MS,
  );
});

describe("WalrusStorage: binary roundtrip", () => {
  test(
    "arbitrary binary bytes survive store/read byte-identical",
    async () => {
      const storage = new WalrusStorage();
      // 1 KiB of pseudo-random bytes (deterministic for idempotency checks)
      const bytes = new Uint8Array(1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 137 + 17) & 0xff;

      const blobId = await storage.storeBytes(bytes);
      expect(blobId).toBeTruthy();

      const back = await storage.readBytes(blobId);
      expect(Buffer.compare(Buffer.from(bytes), Buffer.from(back))).toBe(0);
    },
    TIMEOUT_MS,
  );

  test(
    "idempotent: re-uploading identical bytes returns same blobId",
    async () => {
      const storage = new WalrusStorage();
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const r1 = await storage.storeBytes(bytes);
      const r2 = await storage.storeBytes(bytes);
      expect(r1).toBe(r2);
    },
    TIMEOUT_MS,
  );
});

describe("getStorageBackend", () => {
  test("returns WalrusStorage when STORAGE_BACKEND=walrus", () => {
    process.env["STORAGE_BACKEND"] = "walrus";
    const backend = getStorageBackend({ dataDir: "/tmp/test-og-shadow" });
    expect(backend).toBeInstanceOf(WalrusStorage);
  });

  test("returns shadow impl when STORAGE_BACKEND=shadow", () => {
    process.env["STORAGE_BACKEND"] = "shadow";
    const backend = getStorageBackend({ dataDir: "/tmp/test-og-shadow" });
    // It should NOT be a WalrusStorage
    expect(backend).not.toBeInstanceOf(WalrusStorage);
  });

  test("defaults to walrus when STORAGE_BACKEND is unset", () => {
    delete process.env["STORAGE_BACKEND"];
    const backend = getStorageBackend({ dataDir: "/tmp/test-og-shadow" });
    expect(backend).toBeInstanceOf(WalrusStorage);
  });
});
