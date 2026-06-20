import { describe, expect, test } from "bun:test";
import { handleDrillCypher, DRILL_CYPHER_PRICE_SMALLEST } from "./http-handler.ts";
import type { NetworkConfig } from "@stratum/shared";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements, PaymentPayload, VerifyResponse, SettleResponse } from "@x402/core/types";

const mockNet: NetworkConfig = {
  name: "testnet",
  x402: { network: "eip155:84532", facilitatorUrl: "https://x402.org/facilitator" },
  base: {
    rpc: "https://sepolia.base.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
    usdcEip712: { name: "USD Coin", version: "2" },
    chain: { id: 84532, name: "Base Sepolia" },
  },
} as unknown as NetworkConfig;

const mockFacilitatorRequirePayment: FacilitatorClient = {
  verify: async (_p: PaymentPayload, _r: PaymentRequirements): Promise<VerifyResponse> => ({ isValid: false, invalidReason: "no payment" }),
  settle: async (_p: PaymentPayload, _r: PaymentRequirements): Promise<SettleResponse> => ({ success: false, transaction: "", errorReason: "not settled" } as SettleResponse),
  getSupported: async () => ({ kinds: [], extensions: [], signers: {} }),
};

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/run/drill-cypher", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /run/drill-cypher — 400 validation (no network)", () => {
  test("missing opps → 400 before any compute", async () => {
    const res = await handleDrillCypher(makeRequest({}), { net: mockNet, facilitator: mockFacilitatorRequirePayment });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("opps");
  });

  test("empty opps array → 400", async () => {
    const res = await handleDrillCypher(makeRequest({ opps: [] }), { net: mockNet, facilitator: mockFacilitatorRequirePayment });
    expect(res.status).toBe(400);
  });

  test("invalid style → 400", async () => {
    const res = await handleDrillCypher(makeRequest({ opps: ["X"], style: "jazz" }), { net: mockNet, facilitator: mockFacilitatorRequirePayment });
    expect(res.status).toBe(400);
  });
});

describe("POST /run/drill-cypher — 402 payment required", () => {
  test("no payment header → 402 with PAYMENT-REQUIRED header at our price", async () => {
    const res = await handleDrillCypher(makeRequest({ opps: ["ORCL agent"], style: "ny-drill" }), {
      net: mockNet,
      facilitator: mockFacilitatorRequirePayment,
    });
    expect(res.status).toBe(402);
    const prHeader = res.headers.get("PAYMENT-REQUIRED");
    expect(prHeader).toBeTruthy();
    expect(Buffer.from(prHeader!, "base64").toString("utf-8")).toContain(DRILL_CYPHER_PRICE_SMALLEST);
  });
});
