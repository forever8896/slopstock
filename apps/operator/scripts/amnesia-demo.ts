/**
 * Amnesia demo — proves the operator is STATELESS.
 *
 * The agent's whole brain (skills, patterns, memory.db, system prompt, lockfile)
 * lives only in `data/agents/<tokenId>/` on disk. This script snapshots it to
 * Walrus, then performs the "true amnesia moment" — `rm -rf ./data/agents/` —
 * and restores the brain byte-for-byte from Walrus alone. The bundle hash before
 * the wipe must equal the bundle hash after restore, proving nothing was lost.
 *
 * In production hermes the restored blobId is discovered via the agent's ENS
 * `agent-snapshot` text record (mainnet). Mode B exercises that real path.
 *
 * ─── Run modes ───────────────────────────────────────────────────────────────
 *
 * # Mode A (self-contained, Walrus testnet only):
 * bun run apps/operator/scripts/amnesia-demo.ts
 *
 * # Mode B (full live: ENS pointer + optional Seal):
 * AMNESIA_LIVE=1 SNAPSHOT_ENCRYPTION=seal ENS_SNAPSHOT_ENABLED=1 \
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/amnesia-demo.ts'
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { getSnapshotCipher } from "../src/storage/encryption.ts";
import { snapshotAgentDir, restoreAgentDir } from "../src/storage/snapshot.ts";
import { hashBundleDir } from "../src/runtime/bundle.ts";

const TOKEN_ID = "7";
// Relative ./data dir under the repo — NEVER an absolute/parent path.
const DATA_DIR = resolve(process.cwd(), "data");
const AGENTS_DIR = join(DATA_DIR, "agents");
const AGENT_DIR = join(AGENTS_DIR, TOKEN_ID);
const AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space/v1/blobs";

/**
 * Build a realistic agent-brain fixture — mirrors the shape used by
 * `apps/operator/src/storage/snapshot.test.ts`:
 *   skills/*.md, patterns/*.md, system.md, memory.db (real SQLite), bundle.lock.json
 */
async function buildFixtureDir(dir: string): Promise<void> {
  await mkdir(join(dir, "skills"), { recursive: true });
  await mkdir(join(dir, "patterns"), { recursive: true });

  await writeFile(join(dir, "system.md"), "You are a DeFi security auditor agent.\n");

  await writeFile(
    join(dir, "skills", "reentrancy.md"),
    "---\nname: reentrancy\n---\nLook for re-entrant external calls before state updates.\n",
  );

  await writeFile(
    join(dir, "patterns", "checks-effects.md"),
    "# Checks-Effects-Interactions\nAlways update state before external calls.\n",
  );

  await writeFile(
    join(dir, "bundle.lock.json"),
    JSON.stringify({ bundleHash: "0xdeadbeef", version: 1, lastUpdated: 1_700_000_000 }, null, 2),
  );

  // memory.db — real SQLite file with actual learned facts.
  const db = new Database(join(dir, "memory.db"), { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL);
    INSERT OR REPLACE INTO facts VALUES ('last_audit', 'amnesia-demo-fixture', 1700000000);
    INSERT OR REPLACE INTO facts VALUES ('skill_count', '1', 1700000000);
  `);
  db.close();
}

async function main() {
  const live = process.env["AMNESIA_LIVE"] === "1";

  console.log("=== AMNESIA DEMO — proving the operator is stateless ===");
  console.log(`mode: ${live ? "B (live ENS pointer + optional Seal)" : "A (self-contained, Walrus testnet)"}`);
  console.log(`agent dir: ${AGENT_DIR}\n`);

  // 1. Build the fixture brain and hash it.
  await mkdir(AGENT_DIR, { recursive: true });
  await buildFixtureDir(AGENT_DIR);
  const hashBefore = await hashBundleDir(AGENT_DIR);
  console.log(`[1] built agent brain — bundleHash BEFORE: ${hashBefore}`);

  // 2. Snapshot → Walrus.
  const cipher = await getSnapshotCipher();
  console.log(`[2] snapshotting to Walrus (cipher: ${cipher.kind})…`);
  const blobId = await snapshotAgentDir(AGENT_DIR, cipher, TOKEN_ID);
  console.log(`    blobId: ${blobId}`);
  console.log(`    public: ${AGGREGATOR}/${blobId}`);

  // Mode B: publish the blobId pointer into the agent's ENS text record
  // (`agent-snapshot`) on mainnet, then read it back — the production discovery
  // path a stateless operator uses to find the latest snapshot. Env-gated so
  // Mode A never needs mainnet funds or a published Seal package.
  let restoreBlobId = blobId;
  if (live) {
    const { setSnapshotPointer, readSnapshotPointer } = await import("../src/store/snapshot-pointer.ts");
    const ensName = process.env["AMNESIA_ENS_NAME"] ?? "auditor.slopstock.eth";
    const deployerKey = process.env["DEPLOYER_PRIVATE_KEY"] as `0x${string}` | undefined;
    const rpcUrl = process.env["L1_RPC"];
    if (!deployerKey) {
      throw new Error("AMNESIA_LIVE=1 requires DEPLOYER_PRIVATE_KEY (mainnet signer that owns the ENS name)");
    }
    console.log(`\n[2b] LIVE: writing agent-snapshot pointer to ENS '${ensName}' (mainnet)…`);
    await setSnapshotPointer({ ensName, blobId, deployerKey, rpcUrl });
    const fromEns = await readSnapshotPointer({ ensName, rpcUrl });
    if (!fromEns) {
      throw new Error(`ENS pointer read returned null for '${ensName}' — pointer not propagated`);
    }
    console.log(`     read back from ENS: ${fromEns}`);
    if (fromEns !== blobId) {
      throw new Error(`ENS pointer mismatch: wrote ${blobId}, read ${fromEns}`);
    }
    restoreBlobId = fromEns; // restore from the ENS-discovered blobId, like prod.
  }

  // 3. WIPE — the true amnesia moment. Only ./data/agents/, nothing else.
  console.warn(`\n[3] ⚠️  WIPING ${AGENTS_DIR} (data/agents/ only — receipts.db and the rest of data/ untouched)`);
  await rm(AGENTS_DIR, { recursive: true, force: true });
  if (existsSync(AGENTS_DIR)) {
    throw new Error(`wipe failed: ${AGENTS_DIR} still exists`);
  }
  console.log(`    amnesia confirmed — ${AGENTS_DIR} is gone, the operator remembers nothing`);

  // 4. RESTORE from Walrus (blobId supplied directly in Mode A, via ENS in Mode B).
  console.log(`\n[4] restoring from Walrus blobId ${restoreBlobId}…`);
  await restoreAgentDir(AGENT_DIR, restoreBlobId, cipher, TOKEN_ID);
  if (!existsSync(AGENT_DIR)) {
    throw new Error(`restore failed: ${AGENT_DIR} does not exist`);
  }
  const hashAfter = await hashBundleDir(AGENT_DIR);
  console.log(`    bundleHash AFTER:  ${hashAfter}`);

  // 5. ASSERT byte-identical.
  if (hashAfter !== hashBefore) {
    console.error(`\n❌ AMNESIA RESTORE FAILED: hash mismatch`);
    console.error(`   before: ${hashBefore}`);
    console.error(`   after:  ${hashAfter}`);
    process.exit(1);
  }

  console.log(`\n✅ AMNESIA RESTORE VERIFIED: brain byte-identical after full wipe (blobId ${restoreBlobId})`);

  // Clean up the demo fixture so we don't leave stray agent dirs around.
  await rm(AGENTS_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("[amnesia] fatal:", err);
  process.exit(1);
});
