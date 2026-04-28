/**
 * Per-agent expected TEE measurement lookup.
 *
 * On chain, `iNFT.expectedMeasurement(tokenId)` returns keccak(teeAttestation)
 * pinned at mint time. The receipt's `measurement` field must match that
 * value exactly — that's how the subscriber-side verifier proves the output
 * came from the seal pinned to *this* tokenId.
 *
 * In production we'd read from chain on operator boot and cache. For now
 * we just hardcode the values for the agents we've minted; if you redeploy,
 * update both this file and the web's agent-metadata.ts.
 */

import type { Hex } from "@stratum/shared";

const TABLE: Record<string, Hex> = {
  "1": "0x3861e6d72751de965efb8993a0d96e38624b732ddc77a623d7c594ca807ffe37", // AUDIT
  "2": "0xcbb4e6f9d3c522ae5180e5390e3e0432694be771eaf76c8b7a5ebf9f26ce299d", // MEMER
  "3": "0x8d0bfe62c493067ecca0ecc71f046da079008c29dbc4beb0f6a1ebf690eeeba2", // ORCL
};

const FALLBACK: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function measurementForToken(tokenId: bigint): Hex {
  return TABLE[tokenId.toString()] ?? FALLBACK;
}
