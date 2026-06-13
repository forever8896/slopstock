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

import { recordReceipt, listAllReceiptsForToken } from "./receipts.ts";
import type { InferenceReceipt } from "@stratum/shared";

/**
 * Serialize all receipts for a single agent (identified by tokenId) as
 * newline-delimited JSON (NDJSON). Each line is one receipt, ordered by ts ASC
 * so the tape reproduces the original chronological sequence.
 *
 * Returns an empty string if the agent has no receipts.
 * Never includes receipts belonging to other agents.
 *
 * Uses listAllReceiptsForToken() — an unbounded query — so agents with >500
 * receipts are exported completely. Do NOT replace this with listReceipts()
 * which is capped at 500 for the HTTP endpoint.
 */
export function exportAgentReceipts(tokenId: bigint): string {
  const rows = listAllReceiptsForToken(tokenId);
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Re-ingest receipts from NDJSON produced by exportAgentReceipts().
 * Inserts or replaces each row in the local receipts.db (idempotent).
 *
 * tokenId comes out of JSON as a plain number (matching InferenceReceipt),
 * so no bigint re-coercion is needed — recordReceipt handles it via .toString().
 *
 * Malformed lines are skipped with a console.warn rather than aborting the
 * whole import — better to restore most receipts than none.
 *
 * Returns the number of receipts successfully imported.
 */
export function importAgentReceipts(ndjson: string): number {
  let n = 0, bad = 0, idx = 0;
  for (const line of ndjson.split("\n")) {
    const t = line.trim(); idx++;
    if (!t) continue;
    try {
      const r = JSON.parse(t) as InferenceReceipt;
      recordReceipt(r);
      n++;
    } catch (e) {
      bad++;
      console.warn(`[receipts] importAgentReceipts: skipping malformed line ${idx}: ${(e as Error).message}`);
    }
  }
  if (bad > 0) console.warn(`[receipts] importAgentReceipts: ${bad} malformed line(s) skipped, ${n} imported`);
  return n;
}
