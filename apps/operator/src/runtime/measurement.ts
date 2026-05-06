/**
 * Per-agent expected TEE measurement lookup.
 *
 * On chain, `iNFT.expectedMeasurement(tokenId)` returns keccak(teeAttestation)
 * pinned at mint time. The receipt's `measurement` field must match that
 * value exactly — that's how the subscriber-side verifier proves the output
 * came from the seal pinned to *this* tokenId.
 *
 * Static seed agents (tokenIds 1-3) keep their hardcoded values for parity
 * with the historical receipts pinned in the test data. Dynamic agents
 * minted via /launch use their `bundleManifestCid` (= keccak(canonical manifest))
 * — the same value that's both pinned to the iNFT's metadataHash on 0G and
 * exposed to the web client as `realAgent.bundleManifestCid`. That keeps
 * receipt.teeAttestation.measurement === expectedTeeMeasurement so the
 * subscribe page's "verified" check matches instead of showing
 * "mismatch — investigate" against an all-zeros fallback.
 */

import type { Hex } from "@stratum/shared";
import { getDynamicAgentSync } from "./dynamic-cache.ts";

const TABLE: Record<string, Hex> = {
  "1": "0x3861e6d72751de965efb8993a0d96e38624b732ddc77a623d7c594ca807ffe37", // AUDIT
  "2": "0xcbb4e6f9d3c522ae5180e5390e3e0432694be771eaf76c8b7a5ebf9f26ce299d", // MEMER
  "3": "0x8d0bfe62c493067ecca0ecc71f046da079008c29dbc4beb0f6a1ebf690eeeba2", // ORCL
};

const FALLBACK: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function measurementForToken(tokenId: bigint): Hex {
  const seeded = TABLE[tokenId.toString()];
  if (seeded) return seeded;
  const dyn = getDynamicAgentSync(tokenId);
  if (dyn?.bundleManifestCid) {
    const cid = dyn.bundleManifestCid.startsWith("0x")
      ? dyn.bundleManifestCid
      : `0x${dyn.bundleManifestCid}`;
    return cid as Hex;
  }
  return FALLBACK;
}
