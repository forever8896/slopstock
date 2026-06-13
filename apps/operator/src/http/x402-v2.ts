/**
 * x402 v2 — real protocol via the official `@x402/*` packages (replaces the
 * homegrown challenge+txHash flow in x402.ts).
 *
 * v2 wire format (from @x402/core/schemas PaymentRequirementsV2Schema):
 *   { scheme:"exact", network:CAIP-2, amount, asset, payTo, maxTimeoutSeconds, ... }
 * x402Version = 2. Networks are CAIP-2 ("eip155:8453"), NOT the legacy named form.
 *
 * Network + asset come from the NetworkConfig (one-switch testnet/mainnet) —
 * the first call-site migrated onto getNetwork().
 */

import type { NetworkConfig } from "@stratum/shared";
import { x402Version } from "@x402/core";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  FacilitatorClient,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";

export interface AgentPaymentOpts {
  /** USDC amount in smallest units (6dp). */
  priceSmallest: string;
  /** Recipient — the agent's RevenueVault. */
  payTo: `0x${string}`;
  /** The resource URL being paid for. */
  resource: string;
  description?: string;
  maxTimeoutSeconds?: number;
}

export function buildAgentPaymentRequirements(
  net: NetworkConfig,
  o: AgentPaymentOpts,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: net.x402.network, // CAIP-2, e.g. "eip155:8453"
    amount: o.priceSmallest,
    asset: net.base.usdc,
    payTo: o.payTo,
    maxTimeoutSeconds: o.maxTimeoutSeconds ?? 120,
    resource: o.resource,
    description: o.description ?? "",
    // EIP-712 domain for the USDC EIP-3009 authorization the client signs.
    extra: { name: net.base.usdcEip712.name, version: net.base.usdcEip712.version },
  } as PaymentRequirements;
}

/**
 * Build the HTTP 402 response — a spec-valid v2 PaymentRequired body
 * ({ x402Version, resource, accepts }). Returned when a request arrives with
 * no (or an invalid) X-PAYMENT header.
 */
export function build402(resource: string, accepts: PaymentRequirements[]): Response {
  // v2 PaymentRequired.resource is a ResourceInfo object ({ url }), not a bare URL.
  const body = { x402Version, resource: { url: resource }, accepts } as PaymentRequired;
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "content-type": "application/json",
      // The v2 client reads requirements from this header (the JSON body branch
      // is v1-only). encodePaymentRequiredHeader base64-encodes the PaymentRequired.
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body),
    },
  });
}

/** Encode a settlement result into the PAYMENT-RESPONSE header the v2 client reads. */
export function settleResponseHeader(settle: SettleResponse): string {
  return encodePaymentResponseHeader(settle);
}

/**
 * Decode the client's X-PAYMENT header (base64 of a v2 PaymentPayload JSON).
 * Returns null for a missing, malformed, or schema-invalid header so callers
 * can simply re-issue the 402.
 */
export function decodePaymentHeader(headerValue: string | null): PaymentPayload | null {
  if (!headerValue) return null;
  try {
    // v2 clients send the PAYMENT-SIGNATURE header; this decodes its base64 envelope.
    return decodePaymentSignatureHeader(headerValue) as PaymentPayload;
  } catch {
    return null;
  }
}

/** Header name a v2 client uses to carry the signed payment. */
export const PAYMENT_HEADER = "PAYMENT-SIGNATURE";

/**
 * Facilitator client for the selected network. Testnet uses the keyless public
 * facilitator; mainnet points at the CDP facilitator (CDP auth headers wired in
 * the funded-integration step via FacilitatorConfig.createAuthHeaders).
 */
export function createFacilitator(net: NetworkConfig): FacilitatorClient {
  return new HTTPFacilitatorClient({ url: net.x402.facilitatorUrl });
}

/** Result of the inbound payment gate: pay-or-402. */
export type PaymentGate =
  | { ok: false; response: Response }
  | { ok: true; payload: PaymentPayload; requirements: PaymentRequirements; payer?: string };

/**
 * Inbound gate: decode the client's payment, verify it with the facilitator,
 * and either admit the request (caller does the work, then settles) or hand
 * back a fresh 402. Verify happens BEFORE the work; settlement is the caller's
 * job after the work succeeds (so we never settle for failed work).
 */
export async function requirePayment(args: {
  paymentHeader: string | null;
  resource: string;
  requirements: PaymentRequirements;
  facilitator: Pick<FacilitatorClient, "verify">;
}): Promise<PaymentGate> {
  const { paymentHeader, resource, requirements, facilitator } = args;
  const payload = decodePaymentHeader(paymentHeader);
  if (!payload) return { ok: false, response: build402(resource, [requirements]) };

  let verdict: VerifyResponse;
  try {
    verdict = await facilitator.verify(payload, requirements);
  } catch {
    return { ok: false, response: build402(resource, [requirements]) };
  }
  if (!verdict.isValid) return { ok: false, response: build402(resource, [requirements]) };

  return { ok: true, payload, requirements, payer: verdict.payer };
}

/**
 * Settle a verified payment AFTER the work succeeded. Never throws — a facilitator
 * error or a failed settlement comes back as `{ success: false }` so the caller
 * can decide how to surface it (the work is already done; we just record the result).
 */
export async function settlePayment(args: {
  facilitator: Pick<FacilitatorClient, "settle">;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}): Promise<SettleResponse> {
  try {
    return await args.facilitator.settle(args.payload, args.requirements);
  } catch (e) {
    return {
      success: false,
      transaction: "",
      errorReason: e instanceof Error ? e.message : "settlement failed",
    } as SettleResponse;
  }
}
