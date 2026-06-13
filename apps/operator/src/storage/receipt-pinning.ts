/**
 * Receipt pinning — stores InferenceReceipts on Walrus and tracks blobIds.
 *
 * Each receipt is pinned as canonical JSON (keys sorted). The Walrus blobId is
 * content-addressed, so identical receipts always get the same blobId — free
 * dedup. The blobId is stored in the receipt index DB alongside the receipt.
 *
 * Why pin to Walrus: the web "inference tape" reads receipts from a public
 * Walrus aggregator URL, not the operator disk. This makes the tape
 * verifiable and portable — any operator can serve the same tape.
 *
 * The pinned blobId is stored in the `walrus_receipt_index` table:
 *   callId TEXT PK, blobId TEXT NOT NULL
 */

import { canonicalizeJson } from "@stratum/shared";
import type { InferenceReceipt } from "@stratum/shared";
import { WalrusStorage } from "./walrus-storage.ts";

const storage = new WalrusStorage();

/**
 * Pin a receipt to Walrus.
 * Returns the Walrus blobId (stable content address).
 */
export async function pinReceiptToWalrus(receipt: InferenceReceipt): Promise<string> {
  // Canonical JSON so identical receipts always hash to the same blobId
  const json = canonicalizeJson(receipt);
  const result = await storage.pinText(json, "application/json");
  return result.rootHash; // rootHash == walrus blobId in WalrusStorage
}

/**
 * Get the public Walrus aggregator URL for a receipt blobId.
 * Web "inference tape" uses this URL to read receipts from Walrus directly.
 */
export function walrusTapeUrl(
  blobId: string,
  aggregator = "https://aggregator.walrus-testnet.walrus.space",
): string {
  return `${aggregator}/v1/blobs/${blobId}`;
}
