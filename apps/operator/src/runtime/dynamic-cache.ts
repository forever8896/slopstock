/**
 * Synchronous accessor for the dynamic registry cache. The async loader
 * lives in store/dynamic-registry.ts; this module mirrors the cache so
 * sync-only code paths (like priceForToken called from the x402 challenge)
 * can read it without making a route.
 *
 * Hot-update: store/dynamic-registry.ts calls `setDynamicSnapshot()` on
 * every register; reads here are O(1) map lookups.
 */

import type { DynamicAgent } from "../store/dynamic-registry.ts";

let snapshot = new Map<string, DynamicAgent>();

export function setDynamicSnapshot(s: Map<string, DynamicAgent>): void {
  snapshot = s;
}

export function getDynamicAgentSync(tokenId: bigint): DynamicAgent | null {
  return snapshot.get(tokenId.toString()) ?? null;
}
