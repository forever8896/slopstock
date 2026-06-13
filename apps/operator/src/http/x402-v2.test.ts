import { describe, expect, test } from "bun:test";
import { PaymentRequiredV2Schema, PaymentRequirementsV2Schema } from "@x402/core/schemas";
import { safeBase64Encode } from "@x402/core/utils";
import { resolveNetwork } from "@stratum/shared";

import { build402, buildAgentPaymentRequirements, decodePaymentHeader } from "./x402-v2";

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

describe("build402", () => {
  const net = resolveNetwork({ NETWORK: "mainnet" });
  const resource = "https://op.slopstock.eth/x402/infer?tokenId=3";
  const reqs = buildAgentPaymentRequirements(net, { priceSmallest: "100000", payTo: VAULT, resource });

  test("returns HTTP 402 with a v2-valid PaymentRequired JSON body", async () => {
    const res = build402(resource, [reqs]);
    expect(res.status).toBe(402);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    const parsed = PaymentRequiredV2Schema.safeParse(body);
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
    expect(body.x402Version).toBe(2);
    expect(body.resource.url).toBe(resource);
    expect(body.accepts[0].amount).toBe("100000");
  });
});

describe("decodePaymentHeader", () => {
  const net = resolveNetwork({ NETWORK: "mainnet" });
  const accepted = buildAgentPaymentRequirements(net, { priceSmallest: "1", payTo: VAULT, resource: "r" });
  const validPayload = {
    x402Version: 2,
    accepted,
    payload: {
      signature: "0xdeadbeef",
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: VAULT,
        value: "1",
        validAfter: "0",
        validBefore: "99999999999",
        nonce: "0x" + "00".repeat(32),
      },
    },
  };

  test("returns null for a missing header", () => {
    expect(decodePaymentHeader(null)).toBeNull();
  });

  test("returns null for a non-base64 / garbage header", () => {
    expect(decodePaymentHeader("!!! not base64 !!!")).toBeNull();
  });

  test("decodes a valid base64 X-PAYMENT into the v2 payload", () => {
    const header = safeBase64Encode(JSON.stringify(validPayload));
    const decoded = decodePaymentHeader(header);
    expect(decoded).not.toBeNull();
    expect(decoded?.x402Version).toBe(2);
  });
});
