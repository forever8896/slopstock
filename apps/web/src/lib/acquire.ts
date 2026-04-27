/**
 * Types for the acquire-page event log. Entries are appended from real
 * `useWatchContractEvent` watchers in acquire-client.tsx.
 */

export type EventKind =
  | "post" // BidPosted
  | "tee" // TEE re-encryption narration
  | "transfer" // iTransfer / Acquired
  | "revoke" // UsageRevoked / cleared grants
  | "ens" // ENS resolver flip
  | "result" // terminal success
  | "info" // network errors, preflight rejections, narration
  | "accept"; // alias for transfer; some events emit this name

export interface EventLogEntry {
  ts: number; // ms since epoch
  kind: EventKind;
  title: string;
  lines: string[];
}
