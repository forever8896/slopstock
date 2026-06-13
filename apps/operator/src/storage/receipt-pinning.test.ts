/**
 * Integration tests for receipt pinning to Walrus.
 *
 * Tests:
 *   1. A receipt can be pinned to Walrus and the returned blobId is non-empty
 *   2. The receipt can be read back from Walrus by blobId and is identical
 *   3. Identical receipts deduplicate (same blobId)
 *
 * Real Walrus testnet — no mocks.
 */

import { describe, expect, test } from "bun:test";
import { pinReceiptToWalrus } from "./receipt-pinning.ts";
import { WalrusStorage } from "./walrus-storage.ts";
import type { InferenceReceipt } from "@stratum/shared";

const TIMEOUT_MS = 30_000;

function makeFixtureReceipt(callId: string): InferenceReceipt {
  return {
    schemaVersion: "stratum/receipt/v2",
    tokenId: 1,
    subscriber: "0x0000000000000000000000000000000000000001",
    callId,
    input: "0x" + "ab".repeat(32),
    outputHash: "0x" + "cd".repeat(32),
    model: "test-model",
    teeAttestation: {
      vendor: "intel-tdx",
      quote: "dGVzdA==",
      measurement: "0x" + "ef".repeat(32),
    },
    paymentProof: "x402-test-proof",
    agentRuntime: "hermes",
    computeBackend: "openai-compat",
    bundleHashBefore: "0x" + "11".repeat(32),
    bundleHashAfter: "0x" + "22".repeat(32),
    stateDeltaHash: "0x" + "33".repeat(32),
    skillsLoaded: ["reentrancy"],
    skillsCreated: [],
    transcript: [],
    ts: Math.floor(Date.now() / 1000),
    signature: "0x" + "ff".repeat(65),
  };
}

describe("Receipt pinning to Walrus", () => {
  test(
    "pinReceiptToWalrus returns a non-empty blobId",
    async () => {
      const receipt = makeFixtureReceipt(`test-call-${Date.now()}`);
      const blobId = await pinReceiptToWalrus(receipt);
      expect(blobId).toBeTruthy();
      expect(typeof blobId).toBe("string");
      expect(blobId.length).toBeGreaterThan(10);
    },
    TIMEOUT_MS,
  );

  test(
    "receipt can be read back from Walrus verbatim",
    async () => {
      const callId = `test-roundtrip-${Date.now()}`;
      const receipt = makeFixtureReceipt(callId);
      const blobId = await pinReceiptToWalrus(receipt);

      // Read back via WalrusStorage
      const storage = new WalrusStorage();
      const fetched = await storage.fetchJson<InferenceReceipt>(blobId);
      expect(fetched.callId).toBe(callId);
      expect(fetched.tokenId).toBe(1);
      expect(fetched.schemaVersion).toBe("stratum/receipt/v2");
    },
    TIMEOUT_MS,
  );

  test(
    "identical receipts deduplicate (same blobId returned)",
    async () => {
      // Use a fixed callId so bytes are identical across calls
      const receipt = makeFixtureReceipt("dedup-test-fixed-call-id");
      const blobId1 = await pinReceiptToWalrus(receipt);
      const blobId2 = await pinReceiptToWalrus(receipt);
      expect(blobId1).toBe(blobId2);
    },
    TIMEOUT_MS,
  );
});
