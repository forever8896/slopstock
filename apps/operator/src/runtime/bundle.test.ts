/**
 * Offline tests for the durable-brain lineage hash (hashBundleDir).
 *
 * These run with NO Walrus / network. They lock in the invariant that the
 * lineage hash tracks ONLY the durable agent brain (memory.db, system.md,
 * skills/*, patterns/*) and is stable against transient / self-referential
 * files that get injected into the dir AFTER the hash is taken and before the
 * snapshot tar (receipts.ndjson, a mutated bundle.lock.json with a
 * walrusSnapshotBlobId). Without the exclusion, a cold-restored agent would
 * NOT re-hash to the bundleHashAfter committed for that turn.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { hashBundleDir } from "./bundle.ts";

async function buildBrainDir(baseDir: string): Promise<string> {
  const dir = join(baseDir, "agent");
  await mkdir(join(dir, "skills"), { recursive: true });
  await mkdir(join(dir, "patterns"), { recursive: true });

  await writeFile(join(dir, "system.md"), "You are a test agent.\n");
  await writeFile(
    join(dir, "skills", "reentrancy.md"),
    "---\nname: reentrancy\n---\nLook for re-entrant calls.\n",
  );
  await writeFile(
    join(dir, "patterns", "checks-effects.md"),
    "# CEI\nUpdate state before external calls.\n",
  );

  // bundle.lock.json — self-referential, stores the hash itself.
  await writeFile(
    join(dir, "bundle.lock.json"),
    JSON.stringify({ bundleHash: "0xdeadbeef", version: 1, lastUpdated: 1 }, null, 2),
  );

  // memory.db — real SQLite brain file.
  const db = new Database(join(dir, "memory.db"), { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL);
    INSERT OR REPLACE INTO facts VALUES ('last_audit', 'fixture', 1);
  `);
  db.close();

  return dir;
}

describe("hashBundleDir — durable-brain-only lineage hash", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "stratum-bundle-hash-test-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  test("hash is invariant to receipts.ndjson + bundle.lock.json mutation", async () => {
    const dir = await buildBrainDir(base);

    // h1: the hash taken at write time (step 1 in runTask).
    const h1 = await hashBundleDir(dir);

    // Simulate the post-hash snapshot chain (steps 2a + 2b in runTask):
    //  (a) export receipts into the dir
    await writeFile(
      join(dir, "receipts.ndjson"),
      JSON.stringify({ tokenId: "3", bundleHashAfter: h1 }) + "\n",
    );
    //  (b) rewrite the lock to add walrusSnapshotBlobId + bump lastUpdated
    await writeFile(
      join(dir, "bundle.lock.json"),
      JSON.stringify(
        {
          bundleHash: h1,
          version: 1,
          lastUpdated: 999999,
          walrusSnapshotBlobId: "blob_abc123",
        },
        null,
        2,
      ),
    );

    // h2: the re-hash a cold restore would compute over the tarred dir.
    const h2 = await hashBundleDir(dir);

    // The lineage hash must NOT depend on receipts/lock — restore matches commit.
    expect(h2).toBe(h1);
  });

  test("hash DOES change when a real brain file changes", async () => {
    const dir = await buildBrainDir(base);
    const before = await hashBundleDir(dir);

    // Mutate an actual brain file.
    await appendFile(join(dir, "skills", "reentrancy.md"), "Also check delegatecall.\n");

    const after = await hashBundleDir(dir);
    expect(after).not.toBe(before);
  });
});
