/**
 * Storage backend factory — returns an OgStorageClient based on the
 * STORAGE_BACKEND environment variable.
 *
 *   STORAGE_BACKEND=walrus   (default) — WalrusStorage (real decentralized storage)
 *   STORAGE_BACKEND=shadow              — OperatorOgStorage (local disk shadow)
 *
 * This is the single integration point to swap the storage layer. All callers
 * that previously obtained an OperatorOgStorage should go through here.
 */

import type { OgStorageClient } from "@stratum/shared";
import { WalrusStorage } from "./walrus-storage.ts";
import { getOperatorOgStorage } from "./og-storage-impl.ts";

export interface StorageBackendOpts {
  /** dataDir is only used for the shadow backend. */
  dataDir: string;
}

export function getStorageBackend(opts: StorageBackendOpts): OgStorageClient {
  const backend = process.env["STORAGE_BACKEND"] ?? "walrus";
  if (backend === "shadow") {
    return getOperatorOgStorage({ dataDir: opts.dataDir });
  }
  // Default: walrus
  return new WalrusStorage();
}
