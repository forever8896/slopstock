/**
 * Deterministic bundle hashing.
 *
 * An agent's "bundle" is a directory tree containing whatever state the
 * runtime persists between tasks (skill docs, memory db, system prompt,
 * lockfile, etc.). We hash it deterministically so that two operators
 * holding the same on-disk state produce the same bundle hash, and so that
 * the iNFT can pin the bundle's identity in `metadataHash`.
 *
 * Algorithm:
 *   1. Walk the directory recursively, sorted by relative path.
 *   2. For each file: keccak256(utf8(relpath) || 0x00 || sha256(content))
 *   3. Concatenate the per-file hashes (already sorted, so stable order).
 *   4. keccak256 of the concatenation = the bundle hash.
 *
 * Rationale: per-file hash binds path AND content; the leading-keccak per
 * file lets us detect content tampering even if path collisions exist
 * (they shouldn't); the final keccak makes the result a single 32-byte
 * value suitable for on-chain commit.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { keccak256, concat, stringToHex } from "viem";
import type { Hex } from "@stratum/shared";

const NULL_BUNDLE_HASH: Hex = keccak256(stringToHex("stratum/empty-bundle"));

/**
 * Hash an on-disk agent bundle. Returns NULL_BUNDLE_HASH if the directory
 * doesn't exist or is empty (caller can treat that as "no state yet").
 */
export async function hashBundleDir(dir: string): Promise<Hex> {
  let exists = false;
  try {
    const s = await stat(dir);
    exists = s.isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) return NULL_BUNDLE_HASH;

  const files = await collectFiles(dir);
  if (files.length === 0) return NULL_BUNDLE_HASH;

  files.sort();
  const perFile: Hex[] = [];
  for (const rel of files) {
    const abs = join(dir, rel);
    const buf = await readFile(abs);
    const sha = createHash("sha256").update(buf).digest();
    const fileHash = keccak256(
      concat([stringToHex(rel), "0x00", `0x${sha.toString("hex")}` as Hex]),
    );
    perFile.push(fileHash);
  }
  return keccak256(concat(perFile));
}

/**
 * keccak(before || after) — proof-of-transition hash for a single task.
 */
export function stateDeltaHash(before: Hex, after: Hex): Hex {
  return keccak256(concat([before, after]));
}

/** keccak("stratum/empty-bundle") — sentinel for new agents. */
export function emptyBundleHash(): Hex {
  return NULL_BUNDLE_HASH;
}

/** Recursively collect all file paths under dir, returned as paths
 *  relative to dir (using forward-slash separators for OS portability). */
async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const abs = join(current, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        out.push(relative(dir, abs).split(/\\/g).join("/"));
      }
    }
  }
  await walk(dir);
  return out;
}

// Re-export `concat` so consumers don't have to depend on viem directly
// for this one helper.
export { concat as concatHex };
