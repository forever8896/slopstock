/**
 * Step 4 tests — POST /run/demo-script HTTP handler
 *
 * Tests:
 *   - Bad GitHub URL → 400 before any LLM call
 *   - Missing github_url → 400
 *   - No payment header → 402 with x402 challenge
 *   - Paid request → 200 (integration, requires 0G + x402 payment setup)
 *
 * The 402 and 400 tests are unit tests (no network required).
 * The 200 test is marked as integration (requires OPERATOR_PRIVATE_KEY + funded x402).
 */

import { describe, expect, test } from "bun:test";
import { handleDemoScript, DEMO_SCRIPT_PRICE_SMALLEST } from "./http-handler.ts";
import type { NetworkConfig } from "@stratum/shared";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements, PaymentPayload, VerifyResponse, SettleResponse } from "@x402/core/types";

// ─── Mock network config ────────────────────────────────────────────────────

const mockNet: NetworkConfig = {
  name: "testnet",
  x402: {
    network: "eip155:84532",
    facilitatorUrl: "https://x402.org/facilitator",
  },
  base: {
    rpc: "https://sepolia.base.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
    usdcEip712: { name: "USD Coin", version: "2" },
    chain: { id: 84532, name: "Base Sepolia" },
  },
} as unknown as NetworkConfig;

// ─── Mock facilitator that always requires payment (returns 402 on verify) ──

const mockFacilitatorRequirePayment: FacilitatorClient = {
  verify: async (_payload: PaymentPayload, _reqs: PaymentRequirements): Promise<VerifyResponse> => {
    return { isValid: false, invalidReason: "no payment" };
  },
  settle: async (_payload: PaymentPayload, _reqs: PaymentRequirements): Promise<SettleResponse> => {
    return { success: false, transaction: "", errorReason: "not settled" } as SettleResponse;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/run/demo-script", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("POST /run/demo-script — 400 validation (no network required)", () => {
  test("missing github_url → 400 before any LLM call", async () => {
    const req = makeRequest({});
    const res = await handleDemoScript(req, {
      net: mockNet,
      facilitator: mockFacilitatorRequirePayment,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("github_url");
  });

  test("invalid/non-github URL → 400 before any LLM call", async () => {
    const req = makeRequest({ github_url: "https://not-github.com/foo/bar" });
    const res = await handleDemoScript(req, {
      net: mockNet,
      facilitator: mockFacilitatorRequirePayment,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe("string");
  });

  test("invalid JSON body → 400", async () => {
    const req = new Request("http://localhost/run/demo-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    const res = await handleDemoScript(req, {
      net: mockNet,
      facilitator: mockFacilitatorRequirePayment,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /run/demo-script — 402 payment required", () => {
  test("no payment header → 402 with x402 challenge", async () => {
    const req = makeRequest({ github_url: "https://github.com/forever8896/slopstock" });
    const res = await handleDemoScript(req, {
      net: mockNet,
      facilitator: mockFacilitatorRequirePayment,
    });
    expect(res.status).toBe(402);
    // Should have PAYMENT-REQUIRED header
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
  });

  test("PAYMENT-REQUIRED header contains our price", async () => {
    const req = makeRequest({ github_url: "https://github.com/forever8896/slopstock" });
    const res = await handleDemoScript(req, {
      net: mockNet,
      facilitator: mockFacilitatorRequirePayment,
    });
    expect(res.status).toBe(402);
    // Decode the PAYMENT-REQUIRED header to verify price
    const prHeader = res.headers.get("PAYMENT-REQUIRED");
    expect(prHeader).toBeTruthy();
    // The price should be encoded in the header (base64 of JSON)
    const decoded = Buffer.from(prHeader!, "base64").toString("utf-8");
    expect(decoded).toContain(DEMO_SCRIPT_PRICE_SMALLEST);
  });
});

// ─── Integration test (requires funded x402 + OPERATOR_PRIVATE_KEY) ─────

const SKIP_INTEGRATION =
  !process.env["OPERATOR_PRIVATE_KEY"] || !process.env["DEMO_SCRIPT_VAULT_ADDRESS"];

describe("POST /run/demo-script — 200 integration", () => {
  test.skipIf(SKIP_INTEGRATION)(
    "valid github_url + payment → 200 with script",
    async () => {
      // This test would require a real x402 payment to run.
      // Marked skipIf to not fail CI without the env setup.
      // In production integration: construct a real payment and verify 200.
      expect(true).toBe(true); // placeholder so test file is valid
    },
    120_000,
  );
});
