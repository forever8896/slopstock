/**
 * In-memory receipt store. Stand-in for the 0G Storage Log writer until that's
 * wired in. The MCP `stratum.agent.attestation` tool reads from here.
 */

import type { InferenceReceipt } from "@stratum/shared";

const _receipts = new Map<string, InferenceReceipt>();

export function recordReceipt(r: InferenceReceipt): void {
  _receipts.set(r.callId, r);
}

export function findReceipt(callId: string): InferenceReceipt | undefined {
  return _receipts.get(callId);
}

export function listReceipts(): InferenceReceipt[] {
  return Array.from(_receipts.values());
}
