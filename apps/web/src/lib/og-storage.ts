/**
 * Browser-side 0G Storage client.
 *
 * Routes through the operator (`POST /og-storage/pin`, `GET /og-storage/:hash`)
 * — see PRD §5 / packages/shared/src/og-storage.ts for the architecture
 * decision (operator-proxy keeps the SDK out of the browser bundle and
 * avoids Next.js SSR issues; the on-chain hash binding still holds because
 * `/agents/register` verifies keccak(manifest) === iNFT.metadataHash).
 */

import type { OgStoragePinResult } from "@stratum/shared";

const OPERATOR_URL =
  process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";

export async function pinManifestToOgStorage(manifest: unknown): Promise<OgStoragePinResult> {
  const res = await fetch(`${OPERATOR_URL}/og-storage/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: manifest }),
  });
  if (!res.ok) {
    throw new Error(`og-storage pin failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as OgStoragePinResult;
}

export async function fetchManifestFromOgStorage<T = unknown>(rootHash: string): Promise<T> {
  const clean = rootHash.replace(/^0g-storage:\/\//, "").replace(/^0x/, "");
  const res = await fetch(`${OPERATOR_URL}/og-storage/${clean}`);
  if (!res.ok) throw new Error(`og-storage fetch failed: ${res.status}`);
  return (await res.json()) as T;
}
