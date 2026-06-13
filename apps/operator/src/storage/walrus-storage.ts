/**
 * WalrusStorage — OgStorageClient backed by Walrus decentralized storage.
 *
 * Drop-in replacement for OperatorOgStorage (the "shadow" impl). The URI
 * scheme `0g-storage://<hash>` is preserved: the rootHash stored here is the
 * Walrus blobId, which is content-addressed by Walrus's erasure-coding scheme.
 *
 * On-chain semantics remain unchanged: the `metadataHash` committed on-chain
 * is still `keccak256(canonicalJson(manifest))` — that's computed before
 * pinning and is independent of the storage backend. The `metadataURI` just
 * references `0g-storage://<walrusBlobId>` instead of a keccak address.
 *
 * Why we still use the "0g-storage://" URI prefix even for Walrus blobs:
 * the on-chain contracts store a URI string; we keep the prefix scheme
 * consistent so no contract changes are needed. The blobId is the real
 * Walrus content address.
 */

import { canonicalizeJson, rootHashToUri } from "@stratum/shared";
import type { OgStorageClient, OgStoragePinResult } from "@stratum/shared";
import { WalrusClient } from "./walrus-client.ts";

/**
 * Default epochs for testnet storage.
 * The public testnet publishers reject large epoch values (>~10) with 500 errors.
 * We use 5 by default (survives 5 testnet days, well past the hackathon).
 * Override via WALRUS_EPOCHS env var.
 */
function defaultEpochs(): number {
  const env = process.env["WALRUS_EPOCHS"];
  return env ? Number(env) : 5;
}

export class WalrusStorage implements OgStorageClient {
  private readonly walrus: WalrusClient;
  private readonly epochs: number;

  constructor(walrus?: WalrusClient) {
    this.epochs = defaultEpochs();
    this.walrus = walrus ?? new WalrusClient({ epochs: this.epochs });
  }

  async pinJson(obj: unknown): Promise<OgStoragePinResult> {
    const text = canonicalizeJson(obj);
    return this.pinText(text, "application/json");
  }

  async pinText(content: string, _contentType = "text/plain"): Promise<OgStoragePinResult> {
    const bytes = new TextEncoder().encode(content);
    const result = await this.walrus.store(bytes, { epochs: this.epochs });
    const rootHash = result.blobId;
    return {
      rootHash,
      uri: rootHashToUri(rootHash),
      size: bytes.byteLength,
      realPin: true,
    };
  }

  async fetchJson<T = unknown>(blobId: string): Promise<T> {
    const text = await this.fetchText(blobId);
    return JSON.parse(text) as T;
  }

  async fetchText(blobId: string): Promise<string> {
    const bytes = await this.walrus.read(blobId);
    return new TextDecoder().decode(bytes);
  }

  // ─── Low-level helpers (used by snapshot/receipt pinning) ────────────────

  /** Store raw bytes; returns the Walrus blobId. */
  async storeBytes(bytes: Uint8Array, opts: { epochs?: number } = {}): Promise<string> {
    const result = await this.walrus.store(bytes, { epochs: opts.epochs ?? this.epochs });
    return result.blobId;
  }

  /** Read raw bytes by Walrus blobId. */
  async readBytes(blobId: string): Promise<Uint8Array> {
    return this.walrus.read(blobId);
  }
}
