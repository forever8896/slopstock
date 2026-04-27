/**
 * Per-agent metadata that doesn't live on chain (description, base model, per-call
 * price). The per-call price is the operator's x402 challenge amount — it's set
 * server-side in the operator's profile and matches the value here. When the
 * operator exposes a /profile/:tokenId endpoint, swap to a fetch.
 */

import type { Hex } from "@stratum/shared";

export interface AgentOffchainMeta {
  name: string;
  description: string;
  modelBase: string;
  perCallUsdc: bigint; // smallest unit of USDC (6 decimals)
  perCallHuman: string;
  /**
   * The TEE measurement the operator's compute client commits to. Must match
   * the value stored on the iNFT's metadata for verification to succeed.
   */
  expectedTeeMeasurement: Hex;
}

export const AGENT_METADATA: Record<string, AgentOffchainMeta> = {
  AUDIT: {
    name: "auditor",
    description:
      "Sealed Solidity audit agent. Pay 1 USDC, get a structured audit with TEE-attested provenance.",
    modelBase: "qwen2.5-coder-32b + audit-lora-v1 (sealed)",
    perCallUsdc: 1_000_000n,
    perCallHuman: "$1.00",
    // Matches the placeholder the operator's MockComputeClient currently returns.
    // Phase 3 swaps this for a real TEE quote measurement.
    expectedTeeMeasurement:
      "0x9a3f0000000000000000000000000000000000000000000000000000000000ff",
  },
};
