/**
 * x402 payment helpers.
 *
 * Minimal subset of the spec — issues 402 with a v1 payment header, validates
 * a returned receipt against the facilitator. In demo mode we trust any
 * non-empty receipt id (no facilitator round-trip), which is enough to drive
 * the rest of the demo arc end-to-end.
 *
 * Real-mode wiring (facilitator HTTP, asset whitelist, signature checks)
 * lands once the chosen facilitator URL is confirmed.
 */

import type { OperatorConfig } from "../config.ts";

export interface PaymentChallenge {
  network: "base";
  asset: "USDC";
  amount: string; // smallest unit
  recipient: `0x${string}`;
}

export interface PaymentReceipt {
  txHash: `0x${string}`;
  facilitator: string;
  receiptId: string;
}

export function build402Response(challenge: PaymentChallenge): Response {
  return new Response("Payment Required", {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT-V1": JSON.stringify(challenge),
    },
  });
}

/**
 * Validate a payment receipt presented by a subscriber.
 * Demo mode: accept any non-empty receiptId. Real mode: round-trip to the
 * x402 facilitator and assert (txHash valid, asset matches, amount ≥ challenge).
 */
export async function validateReceipt(
  receipt: PaymentReceipt | null,
  expected: PaymentChallenge,
  config: OperatorConfig,
): Promise<{ ok: true; receiptId: string } | { ok: false; reason: string }> {
  if (!receipt) return { ok: false, reason: "missing payment receipt" };
  if (!receipt.receiptId) return { ok: false, reason: "empty receiptId" };

  if (config.DEMO_MODE) {
    return { ok: true, receiptId: receipt.receiptId };
  }

  // TODO: facilitator round-trip.
  void expected;
  return { ok: false, reason: "real-mode validation not yet implemented" };
}

export function parsePaymentHeader(headerValue: string | null): PaymentReceipt | null {
  if (!headerValue) return null;
  try {
    const parsed = JSON.parse(headerValue) as PaymentReceipt;
    if (!parsed.txHash || !parsed.receiptId) return null;
    return parsed;
  } catch {
    return null;
  }
}
