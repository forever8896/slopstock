/**
 * Receipt verification.
 *
 * What we check in-browser today (demo-honest level):
 *   1. Receipt is shaped correctly (all required fields present).
 *   2. The receipt's TEE measurement matches the agent's pinned
 *      `expectedTeeMeasurement`.
 *   3. The TEE quote field is non-empty.
 *
 * What we DON'T yet check:
 *   - Signature on the TEE quote against the vendor root cert (Intel TDX
 *     attestation library would be needed in-browser; doable but heavy).
 *   - Operator signature on the receipt (we have the field; we'll hook
 *     ECDSA recover once @stratum/sdk lands).
 *
 * The badge surfaces the verification *level* honestly so judges aren't
 * misled by a green check-mark that's hand-waving the hard parts.
 */

import type { InferenceReceipt } from "@stratum/shared";

export type VerificationLevel =
  | { kind: "verified"; level: "shape+measurement" }
  | { kind: "rejected"; reason: string };

export function verifyReceipt(
  receipt: InferenceReceipt | undefined,
  expectedMeasurement: `0x${string}`,
): VerificationLevel {
  if (!receipt) return { kind: "rejected", reason: "no receipt" };
  if (receipt.schemaVersion !== "stratum/receipt/v2") {
    return { kind: "rejected", reason: `unknown schema: ${receipt.schemaVersion}` };
  }
  if (!receipt.callId) return { kind: "rejected", reason: "missing callId" };
  if (!receipt.outputHash || !receipt.outputHash.startsWith("0x")) {
    return { kind: "rejected", reason: "missing or malformed outputHash" };
  }
  if (!receipt.teeAttestation?.quote) return { kind: "rejected", reason: "missing TEE quote" };
  if (receipt.teeAttestation.measurement !== expectedMeasurement) {
    return {
      kind: "rejected",
      reason: `measurement mismatch: receipt=${receipt.teeAttestation.measurement} expected=${expectedMeasurement}`,
    };
  }
  return { kind: "verified", level: "shape+measurement" };
}
