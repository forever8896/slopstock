/**
 * Receipt fold-in for stateless operation.
 *
 * Before snapshotting an agent directory to Walrus, call exportAgentReceipts()
 * and write the result to receipts.ndjson inside the agent dir. On restore,
 * call importAgentReceipts() with that file's contents to rebuild the local
 * receipts.db cache. This makes receipts.db a rebuildable cache rather than
 * durable state, enabling a fully stateless operator.
 *
 * Notes:
 *   - tokenId in InferenceReceipt is `number`, so JSON.stringify is safe (no
 *     bigint serialization problem). The listReceipts() opts accept `bigint`
 *     and convert internally via .toString().
 *   - importAgentReceipts uses INSERT OR REPLACE (via recordReceipt) so it is
 *     safe to call multiple times on the same data (idempotent).
 */

import { recordReceipt, listReceipts } from "./receipts.ts";
import type { InferenceReceipt } from "@stratum/shared";

/**
 * Serialize all receipts for a single agent (identified by tokenId) as
 * newline-delimited JSON (NDJSON). Each line is one receipt.
 *
 * Returns an empty string if the agent has no receipts.
 * Never includes receipts belonging to other agents.
 */
export function exportAgentReceipts(tokenId: bigint): string {
  // listReceipts caps at 500 by default; pass a high limit so we don't
  // silently truncate active agents. 10 000 covers any realistic workload.
  const rows = listReceipts({ tokenId, limit: 10_000 });
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

/**
 * Re-ingest receipts from NDJSON produced by exportAgentReceipts().
 * Inserts or replaces each row in the local receipts.db (idempotent).
 *
 * tokenId comes out of JSON as a plain number (matching InferenceReceipt),
 * so no bigint re-coercion is needed — recordReceipt handles it via .toString().
 *
 * Returns the number of receipts imported.
 */
export function importAgentReceipts(ndjson: string): number {
  let n = 0;
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const r = JSON.parse(trimmed) as InferenceReceipt;
    recordReceipt(r);
    n++;
  }
  return n;
}
