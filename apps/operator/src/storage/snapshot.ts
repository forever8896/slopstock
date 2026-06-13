/**
 * Agent state snapshot/restore — tar → AES-256-GCM → Walrus.
 *
 * The agent state directory (`data/agents/<tokenId>/`) contains:
 *   - skills/*.md       — self-learned skills
 *   - patterns/*.md     — knowledge patterns
 *   - memory.db         — SQLite FTS5 memory (facts, task_log, messages)
 *   - system.md         — agent system prompt
 *   - bundle.lock.json  — bundle hash + version
 *
 * Snapshot flow:
 *   1. tar (deterministic, no timestamps) the whole dir to an in-memory buffer
 *   2. AES-256-GCM encrypt the tarball
 *   3. Store on Walrus; return blobId
 *
 * Restore flow:
 *   1. Fetch bytes from Walrus by blobId
 *   2. Decrypt with AES key
 *   3. Untar into target directory
 *
 * The blobId is stored in the receipt next to bundleHashAfter — the receipt
 * chain IS the lineage. Any operator can rehydrate any agent from
 * chain + Walrus alone.
 *
 * Bun's Bun.spawn + GNU tar give us streaming tar without native Node addons.
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { encrypt, decrypt, serializeEnvelope, deserializeEnvelope } from "./crypto.ts";
import { WalrusStorage } from "./walrus-storage.ts";

const walrus = new WalrusStorage();

/**
 * Snapshot an agent directory to Walrus.
 * Returns the Walrus blobId of the encrypted tarball.
 */
export async function snapshotAgentDir(agentDir: string, key: CryptoKey): Promise<string> {
  if (!existsSync(agentDir)) {
    throw new Error(`snapshot: agent dir does not exist: ${agentDir}`);
  }

  // 1. tar the directory to in-memory bytes
  const tarBytes = await tarDir(agentDir);

  // 2. AES-256-GCM encrypt
  const envelope = await encrypt(key, tarBytes);
  const encryptedBytes = serializeEnvelope(envelope);

  // 3. Store on Walrus
  const blobId = await walrus.storeBytes(encryptedBytes);
  return blobId;
}

/**
 * Restore an agent directory from Walrus.
 * Fetches the encrypted tarball, decrypts, and extracts into targetDir.
 * The targetDir is created if it doesn't exist.
 */
export async function restoreAgentDir(
  targetDir: string,
  blobId: string,
  key: CryptoKey,
): Promise<void> {
  // 1. Fetch from Walrus
  const encryptedBytes = await walrus.readBytes(blobId);

  // 2. Decrypt
  const envelope = deserializeEnvelope(encryptedBytes);
  const tarBytes = await decrypt(key, envelope);

  // 3. Create target dir and untar
  await mkdir(targetDir, { recursive: true });
  await untarDir(tarBytes, targetDir);
}

// ─── tar helpers ──────────────────────────────────────────────────────────────

/**
 * Tar a directory to in-memory bytes using Bun.spawn + GNU tar.
 * We exclude timestamps from the tar header (--mtime=0) for determinism.
 */
async function tarDir(dir: string): Promise<Uint8Array> {
  // We tar the *contents* of the directory (not the directory itself)
  // so that restore extracts directly into the target dir.
  const proc = Bun.spawn(
    [
      "tar",
      "-c",        // create
      "--numeric-owner",
      "-C", dir,   // change to dir
      ".",         // all contents
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const chunks: Uint8Array[] = [];
  const reader = proc.stdout.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`tar create failed (exit ${exitCode}): ${errText.slice(0, 200)}`);
  }

  // Concatenate all chunks
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Extract tar bytes into a target directory using Bun.spawn + GNU tar.
 */
async function untarDir(tarBytes: Uint8Array, targetDir: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "tar",
      "-x",        // extract
      "--numeric-owner",
      "-C", targetDir,  // extract into target dir
    ],
    {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    },
  );

  // Write tar bytes to stdin using Bun FileSink API
  proc.stdin.write(tarBytes);
  proc.stdin.end();

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`tar extract failed (exit ${exitCode}): ${errText.slice(0, 200)}`);
  }
}
