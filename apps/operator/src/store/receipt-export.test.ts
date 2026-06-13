/**
 * Tests for per-agent receipt export/import (fold-in for stateless restore).
 *
 * DB lifecycle: receipts.ts uses a module-level singleton (_db). We exploit
 * RECEIPTS_DB_PATH=:memory: + __resetReceiptsDbForTest() to get a truly empty
 * database for each test — each reset closes the old connection and the next
 * db() call opens a fresh :memory: instance.
 */

import { test, expect, beforeEach, beforeAll } from "bun:test";
import { recordReceipt, listReceipts, __resetReceiptsDbForTest } from "./receipts.ts";
import { exportAgentReceipts, importAgentReceipts } from "./receipt-export.ts";
import type { InferenceReceipt } from "@stratum/shared";

// Force in-memory DB for all tests in this file.
beforeAll(() => {
  process.env["RECEIPTS_DB_PATH"] = ":memory:";
});

// Fresh empty DB before each test.
beforeEach(() => {
  __resetReceiptsDbForTest();
});

function fakeReceipt(callId: string, tokenId: number): InferenceReceipt {
  return {
    schemaVersion: "stratum/receipt/v2",
    tokenId,
    subscriber: "0x0000000000000000000000000000000000000abc",
    callId,
    input: "0x" + "aa".repeat(32),
    outputHash: "0x" + "bb".repeat(32),
    model: "deepseek",
    teeAttestation: {
      vendor: "intel-tdx",
      quote: "dGVzdA==",
      measurement: "0x" + "cc".repeat(32),
    },
    paymentProof: "x402-test",
    agentRuntime: "hermes",
    computeBackend: "openai-compat",
    bundleHashBefore: "0x" + "11".repeat(32),
    bundleHashAfter: "0x" + "22".repeat(32),
    stateDeltaHash: "0x" + "33".repeat(32),
    skillsLoaded: [],
    skillsCreated: [],
    transcript: [],
    ts: 1700000000,
    signature: "0x" + "ff".repeat(65),
  };
}

test("export then import round-trips an agent's receipts", () => {
  // Populate: two receipts for agent 3, one for agent 5.
  recordReceipt(fakeReceipt("call-1", 3));
  recordReceipt(fakeReceipt("call-2", 3));
  recordReceipt(fakeReceipt("other", 5)); // different agent — must NOT be exported

  const ndjson = exportAgentReceipts(3n);
  const lines = ndjson.trim().split("\n");
  expect(lines.length).toBe(2);

  // Each line must parse as valid JSON referencing agent 3.
  for (const line of lines) {
    const r = JSON.parse(line);
    expect(String(r.tokenId)).toBe("3");
  }

  // Simulate cold-start: discard the current DB and open a fresh empty one.
  __resetReceiptsDbForTest();

  // Verify it's truly empty before import.
  expect(listReceipts({ tokenId: 3n })).toHaveLength(0);

  // Import and verify restoration.
  const count = importAgentReceipts(ndjson);
  expect(count).toBe(2);

  const restored = listReceipts({ tokenId: 3n });
  expect(restored.map((r) => r.callId).sort()).toEqual(["call-1", "call-2"]);
});

test("exportAgentReceipts never leaks another agent's receipts", () => {
  recordReceipt(fakeReceipt("a1", 3));
  recordReceipt(fakeReceipt("b1", 5));
  recordReceipt(fakeReceipt("b2", 5));

  const ndjson3 = exportAgentReceipts(3n);
  expect(ndjson3.trim().split("\n").length).toBe(1);
  expect(JSON.parse(ndjson3.trim()).callId).toBe("a1");

  const ndjson5 = exportAgentReceipts(5n);
  expect(ndjson5.trim().split("\n").length).toBe(2);
  for (const line of ndjson5.trim().split("\n")) {
    expect(JSON.parse(line).callId).not.toBe("a1");
  }
});

test("exportAgentReceipts returns empty string for agent with no receipts", () => {
  const ndjson = exportAgentReceipts(99n);
  expect(ndjson.trim()).toBe("");
});

test("importAgentReceipts returns 0 for empty input", () => {
  expect(importAgentReceipts("")).toBe(0);
  expect(importAgentReceipts("   \n  \n  ")).toBe(0);
});

test("importAgentReceipts is idempotent (INSERT OR REPLACE)", () => {
  recordReceipt(fakeReceipt("call-dup", 7));
  const ndjson = exportAgentReceipts(7n);

  // Import twice — should not throw and count should not grow.
  importAgentReceipts(ndjson);
  importAgentReceipts(ndjson);

  const rows = listReceipts({ tokenId: 7n });
  expect(rows).toHaveLength(1);
  expect(rows.at(0)?.callId).toBe("call-dup");
});
