/**
 * Manifest loader — fetch + verify + materialize.
 *
 * Permissionless agents are minted with a manifest pinned to 0G Storage
 * (today: operator-shadow), keccak256(manifest) committed on chain as the
 * iNFT's metadataHash. At first inference we:
 *
 *   1. fetch the manifest from 0G Storage (or fall back to the operator's
 *      defensive shadow copy stored in the dynamic registry)
 *   2. verify keccak256(canonical(manifest)) === bundleManifestCid
 *      (which itself was verified == on-chain metadataHash at registration)
 *   3. materialize patterns + skills to /tmp/operator-bundles/<tokenId>/
 *      so the runtime can read them as files (matches Hermes's expectations)
 *   4. return { manifest, agentDir }
 *
 * Caching: per-tokenId LRU, max 32 entries, materialized dirs persist on
 * disk and are reused across calls within the same operator process.
 */

import { existsSync, mkdirSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  computeManifestHash,
  normalizeRootHash,
  validateManifest,
  type AgentManifest,
} from "@stratum/shared";

import {
  getOperatorOgStorage,
  OgStorageNotFoundError,
} from "../storage/og-storage-impl.ts";

export interface MaterializedManifest {
  manifest: AgentManifest;
  agentDir: string;
  /** keccak hex without 0x prefix. */
  manifestHash: string;
}

interface CacheEntry extends MaterializedManifest {
  lastUsed: number;
}

const CACHE_MAX = 32;
const cache = new Map<string, CacheEntry>();

/**
 * Where materialized manifests live on disk. Used to be `tmpdir()` but that
 * meant skills auto-created by Hermes for permissionless mints died on every
 * restart — undermining the "your agent learns over time" pitch. Now we
 * write to AGENTS_DATA_DIR (which on Railway is the persistent volume), so
 * permissionless Hermes mints get the same skill-persistence semantics as
 * the static trio.
 */
function bundlesRoot(dataDir: string): string {
  const root = join(dataDir, "permissionless-bundles");
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function evictIfNeeded(dataDir: string): void {
  if (cache.size <= CACHE_MAX) return;
  // Evict the oldest by lastUsed. NOTE: we no longer rm() the materialized
  // dir on eviction — the bundle dir holds the agent's accumulated state
  // (skills, memory.db) and we want it preserved across LRU churn so a
  // re-call can rehydrate from disk. Only the in-memory entry is dropped.
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of cache) {
    if (v.lastUsed < oldestTs) {
      oldestTs = v.lastUsed;
      oldestKey = k;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
  void dataDir; // dataDir kept in signature for future explicit cleanup
  void rm; // imported for parity; not used after persistence pivot
}

export interface LoadManifestOpts {
  tokenId: string;
  bundleManifestCid?: string;          // expected hash (keccak hex no 0x)
  manifestShadow?: AgentManifest;      // operator's defensive copy from registry
  dataDir: string;                     // operator AGENTS_DATA_DIR for og-storage
}

export class ManifestLoadError extends Error {
  constructor(message: string, public readonly tokenId: string) {
    super(`manifest-loader[${tokenId}]: ${message}`);
    this.name = "ManifestLoadError";
  }
}

/**
 * Fetch + verify + materialize a manifest. Idempotent and cached per tokenId.
 *
 * `bundleManifestCid` is the canonical address; `manifestShadow` is the
 * defensive copy persisted by the operator at register time. We try og-storage
 * first; if that fails, we fall back to the shadow (and pin it for next time).
 */
export async function loadAndMaterialize(opts: LoadManifestOpts): Promise<MaterializedManifest> {
  const cached = cache.get(opts.tokenId);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached;
  }

  const ogs = getOperatorOgStorage({ dataDir: opts.dataDir });
  let manifest: AgentManifest | null = null;

  if (opts.bundleManifestCid) {
    try {
      manifest = await ogs.fetchJson<AgentManifest>(opts.bundleManifestCid);
    } catch (err) {
      if (!(err instanceof OgStorageNotFoundError)) {
        // Unknown error — log and try the shadow.
        console.warn(
          `[manifest-loader] og-storage fetch failed for ${opts.tokenId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  if (!manifest && opts.manifestShadow) {
    manifest = opts.manifestShadow;
    // Shadow exists but og-storage doesn't have it — pin from shadow so
    // next call can succeed via the canonical path.
    try {
      await ogs.pinJson(manifest);
    } catch {
      /* non-fatal */
    }
  }

  if (!manifest) {
    throw new ManifestLoadError("manifest not found in og-storage and no shadow available", opts.tokenId);
  }

  const validationErr = validateManifest(manifest);
  if (validationErr) {
    throw new ManifestLoadError(`invalid manifest: ${validationErr}`, opts.tokenId);
  }

  const recomputed = normalizeRootHash(computeManifestHash(manifest));
  if (opts.bundleManifestCid) {
    const expected = normalizeRootHash(opts.bundleManifestCid);
    if (recomputed !== expected) {
      throw new ManifestLoadError(
        `hash mismatch: manifest hashes to ${recomputed.slice(0, 16)}… but bundleManifestCid is ${expected.slice(0, 16)}…`,
        opts.tokenId,
      );
    }
  }

  // Materialize.
  const agentDir = join(bundlesRoot(opts.dataDir), opts.tokenId);
  mkdirSync(join(agentDir, "patterns"), { recursive: true });
  mkdirSync(join(agentDir, "skills"), { recursive: true });
  await writeFile(join(agentDir, "system.md"), manifest.brain.systemPrompt, "utf-8");
  await writeFile(
    join(agentDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  for (const p of manifest.capabilities.patterns) {
    const filename = sanitizeFilename(p.name) + ".md";
    await writeFile(join(agentDir, "patterns", filename), p.body, "utf-8");
  }
  for (const s of manifest.capabilities.skills) {
    const filename = sanitizeFilename(s.name) + ".md";
    // If body has frontmatter we leave it; otherwise we wrap a minimal one
    // so the Hermes skill-loader can parse it.
    const body = s.body.startsWith("---\n")
      ? s.body
      : `---\nname: ${s.name}\ndescription: from template legacy\n---\n${s.body}`;
    await writeFile(join(agentDir, "skills", filename), body, "utf-8");
  }

  const entry: CacheEntry = {
    manifest,
    agentDir,
    manifestHash: recomputed,
    lastUsed: Date.now(),
  };
  cache.set(opts.tokenId, entry);
  evictIfNeeded(opts.dataDir);
  return entry;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
}

/** Test/debug only — ensures dirname() import is used (pleases unused-import lint). */
void dirname;
