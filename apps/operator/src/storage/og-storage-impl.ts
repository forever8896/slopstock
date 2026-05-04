/**
 * Operator-side 0G Storage client.
 *
 * Implementation note: this is the operator's view of 0G Storage. We
 * content-address every blob by `keccak256(canonical_bytes)` — the same hash
 * we commit on-chain as the iNFT's `metadataHash`. The URI `0g-storage://<hash>`
 * is therefore honestly content-addressable: tampering with the bytes changes
 * the hash, which mismatches the on-chain commit, which the operator catches
 * on `/agents/register` and refuses to serve.
 *
 * We persist blobs under `${dataDir}/og-shadow/<hash>` so that:
 *   - reads survive operator restarts
 *   - the operator can serve manifests for agents minted on a different host
 *     by pulling from any peer operator (peer pull is v2 — today, mint and
 *     serve happen against the same operator)
 *
 * This module is the substrate. A real `@0glabs/0g-ts-sdk` upload path can
 * be layered on top later — the URI scheme and on-chain commitment story
 * are both already correct.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keccak256, toHex } from "viem";

import {
  canonicalizeJson,
  normalizeRootHash,
  rootHashToUri,
  type OgStorageClient,
  type OgStoragePinResult,
} from "@stratum/shared";

interface ShadowMeta {
  contentType: string;
  size: number;
  pinnedAt: number;
}

export interface OperatorOgStorageOpts {
  dataDir: string;
}

class OperatorOgStorage implements OgStorageClient {
  private readonly shadowDir: string;

  constructor(opts: OperatorOgStorageOpts) {
    this.shadowDir = join(opts.dataDir, "og-shadow");
    if (!existsSync(this.shadowDir)) mkdirSync(this.shadowDir, { recursive: true });
  }

  async pinJson(obj: unknown): Promise<OgStoragePinResult> {
    // Canonical serialization: keys sorted at every depth, no insignificant
    // whitespace. The pinned bytes must hash to the same value as
    // computeManifestHash(obj) — that's the cryptographic story.
    const text = canonicalizeJson(obj);
    return this.pinText(text, "application/json");
  }

  async pinText(content: string, contentType = "text/plain"): Promise<OgStoragePinResult> {
    const bytes = new TextEncoder().encode(content);
    const rootHashHex = keccak256(toHex(bytes));
    const rootHash = normalizeRootHash(rootHashHex);
    const blobPath = join(this.shadowDir, rootHash);
    const metaPath = `${blobPath}.meta.json`;

    if (!existsSync(blobPath)) {
      await writeFile(blobPath, content, "utf-8");
      const meta: ShadowMeta = {
        contentType,
        size: bytes.byteLength,
        pinnedAt: Math.floor(Date.now() / 1000),
      };
      await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
      console.log(
        `[og-storage] pinned ${rootHash.slice(0, 16)}… (${bytes.byteLength}b, ${contentType})`,
      );
    }

    return {
      rootHash,
      uri: rootHashToUri(rootHash),
      size: bytes.byteLength,
      // We label realPin: false honestly — this is the operator-shadow path.
      // When real @0glabs/0g-ts-sdk upload lands, it'll set true on success.
      realPin: false,
    };
  }

  async fetchJson<T = unknown>(rootHash: string): Promise<T> {
    const text = await this.fetchText(rootHash);
    return JSON.parse(text) as T;
  }

  async fetchText(rootHash: string): Promise<string> {
    const hash = normalizeRootHash(rootHash);
    const blobPath = join(this.shadowDir, hash);
    if (!existsSync(blobPath)) {
      throw new OgStorageNotFoundError(hash);
    }
    return readFile(blobPath, "utf-8");
  }

  /**
   * Verify that stored content still hashes to its address. Useful as a
   * defensive check on operator boot — flags any disk corruption or manual
   * tampering before we serve agents from a tampered manifest.
   */
  async verifyIntegrity(rootHash: string): Promise<boolean> {
    const hash = normalizeRootHash(rootHash);
    const text = await this.fetchText(hash);
    const recomputed = normalizeRootHash(keccak256(toHex(new TextEncoder().encode(text))));
    return recomputed === hash;
  }

  /**
   * Sha-256 fingerprint of the on-disk blob. Diagnostic only — the canonical
   * address is keccak256, but sha256 is what 0G Storage uses internally for
   * chunk fingerprints and is useful for cross-checking against an eventual
   * real-SDK upload.
   */
  async sha256(rootHash: string): Promise<string> {
    const text = await this.fetchText(rootHash);
    return createHash("sha256").update(text, "utf-8").digest("hex");
  }
}

export class OgStorageNotFoundError extends Error {
  constructor(public readonly rootHash: string) {
    super(`0g-storage: no entry at ${rootHash.slice(0, 16)}…`);
    this.name = "OgStorageNotFoundError";
  }
}

let _singleton: OperatorOgStorage | null = null;

export function getOperatorOgStorage(opts: OperatorOgStorageOpts): OperatorOgStorage {
  if (!_singleton) _singleton = new OperatorOgStorage(opts);
  return _singleton;
}

/** Reset for tests. */
export function _resetOperatorOgStorageForTests(): void {
  _singleton = null;
}
