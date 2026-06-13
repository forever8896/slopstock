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
import { PaymentPayloadV2Schema } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { safeBase64Decode } from "@x402/core/utils";

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
    headers: { "content-type": "application/json" },
  });
}

/**
 * Decode the client's X-PAYMENT header (base64 of a v2 PaymentPayload JSON).
 * Returns null for a missing, malformed, or schema-invalid header so callers
 * can simply re-issue the 402.
 */
export function decodePaymentHeader(headerValue: string | null): PaymentPayload | null {
  if (!headerValue) return null;
  try {
    const parsed = PaymentPayloadV2Schema.safeParse(JSON.parse(safeBase64Decode(headerValue)));
    return parsed.success ? (parsed.data as PaymentPayload) : null;
  } catch {
    return null;
  }
}
