import { describe, expect, test } from "bun:test";
import { PaymentRequirementsV2Schema } from "@x402/core/schemas";
import { resolveNetwork } from "@stratum/shared";

import { buildAgentPaymentRequirements } from "./x402-v2";

const VAULT = "0x1c1fa59c0b6e631a47c7ec4717af3a0b7bfdb382" as const;

describe("buildAgentPaymentRequirements (x402 v2)", () => {
  test("validates against @x402/core's v2 PaymentRequirements schema", () => {
    const reqs = buildAgentPaymentRequirements(resolveNetwork({ NETWORK: "mainnet" }), {
      priceSmallest: "100000",
      payTo: VAULT,
      resource: "https://op.slopstock.eth/x402/infer?tokenId=3",
      description: "ORCL price attestation",
    });
    const parsed = PaymentRequirementsV2Schema.safeParse(reqs);
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });

  test("uses CAIP network + `amount` (v2), derived from NetworkConfig", () => {
    const main = buildAgentPaymentRequirements(resolveNetwork({ NETWORK: "mainnet" }), {
      priceSmallest: "1", payTo: VAULT, resource: "r",
    });
    expect(main.network).toBe("eip155:8453");
    expect(main.amount).toBe("1");
    expect(main.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

    const test = buildAgentPaymentRequirements(resolveNetwork({}), {
      priceSmallest: "1", payTo: VAULT, resource: "r",
    });
    expect(test.network).toBe("eip155:84532");
    expect(test.asset.toLowerCase()).toBe("0xd44e0c3a9fa12e5c00c1714b51f4d8607962e603");
  });

  test("amount is the price in smallest units; payTo is the vault", () => {
    const reqs = buildAgentPaymentRequirements(resolveNetwork({}), {
      priceSmallest: "100000", payTo: VAULT, resource: "r",
    });
    expect(reqs.amount).toBe("100000");
    expect(reqs.payTo).toBe(VAULT);
  });
});
