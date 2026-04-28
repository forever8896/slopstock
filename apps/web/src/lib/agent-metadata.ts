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
      "Sealed Solidity audit agent. Pay 1 USDC, get a structured audit with TEE-attested provenance. Hermes-pattern runtime — tools, persistent memory, autonomous skill creation.",
    modelBase: "qwen2.5-coder-32b + audit-lora-v1 (sealed) — Hermes pattern",
    perCallUsdc: 1_000_000n,
    perCallHuman: "$1.00",
    // The iNFT pins keccak(teeAttestation) at mint time. Operator emits the
    // same value so the web's AttestationBadge verifies cleanly. The real
    // ERC-7857 fork will swap this for a parsed TDX/SGX quote measurement.
    expectedTeeMeasurement:
      "0x3861e6d72751de965efb8993a0d96e38624b732ddc77a623d7c594ca807ffe37",
  },
  MEMER: {
    name: "memer",
    description:
      "Quick ruggability check for meme-token contracts. Single-shot raw-model agent — no tools, no memory. Pay $0.50, get a 1–10 rating with rationale.",
    modelBase: "qwen2.5-coder-7b (raw) — openai-compat runtime",
    perCallUsdc: 500_000n,
    perCallHuman: "$0.50",
    expectedTeeMeasurement:
      "0xcbb4e6f9d3c522ae5180e5390e3e0432694be771eaf76c8b7a5ebf9f26ce299d",
  },
};
