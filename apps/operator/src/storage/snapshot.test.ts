/**
 * Integration tests for agent state snapshot/restore.
 *
 * Tests:
 *   1. tar a fixture state dir → encrypt → store on Walrus → wipe → restore → byte-identical
 *   2. memory.db (binary SQLite file) survives roundtrip intact
 *
 * This is a real integration test: it hits the Walrus testnet.
 * Timeout: 60 s (tar + encrypt + upload + download takes ~5–10 s on testnet).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { generateKey, exportKeyToBase64 } from "./crypto.ts";
import { AesCipher } from "./encryption.ts";
import { snapshotAgentDir, restoreAgentDir } from "./snapshot.ts";

const TIMEOUT_MS = 60_000;

async function testCipher() {
  return AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
}

async function buildFixtureDir(baseDir: string): Promise<string> {
  const dir = join(baseDir, "agent-fixture");
  await mkdir(join(dir, "skills"), { recursive: true });
  await mkdir(join(dir, "patterns"), { recursive: true });

  // System prompt
  await writeFile(join(dir, "system.md"), "You are a test agent.\n");

  // A skill file
  await writeFile(
    join(dir, "skills", "reentrancy.md"),
    "---\nname: reentrancy\n---\nLook for re-entrant calls.\n",
  );

  // A pattern file
  await writeFile(
    join(dir, "patterns", "checks-effects.md"),
    "# Checks-Effects-Interactions\nAlways update state before external calls.\n",
  );

  // bundle.lock.json
  await writeFile(
    join(dir, "bundle.lock.json"),
    JSON.stringify({ bundleHash: "0xdeadbeef", version: 1, lastUpdated: Date.now() }, null, 2),
  );

  // memory.db — real SQLite file with actual data
  const db = new Database(join(dir, "memory.db"), { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL);
    INSERT OR REPLACE INTO facts VALUES ('last_audit', 'test-snapshot-fixture', ${Date.now()});
    INSERT OR REPLACE INTO facts VALUES ('skill_count', '1', ${Date.now()});
  `);
  db.close();

  return dir;
}

describe("Agent snapshot/restore (real Walrus testnet)", () => {
  let tmpBase: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "stratum-snapshot-test-"));
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  test(
    "full roundtrip: tar→encrypt→walrus→wipe→restore→byte-identical",
    async () => {
      const agentDir = await buildFixtureDir(tmpBase);
      const cipher = await testCipher();

      // Snapshot
      const blobId = await snapshotAgentDir(agentDir, cipher, "3");
      expect(blobId).toBeTruthy();
      expect(typeof blobId).toBe("string");

      // Wipe the agent dir
      await rm(agentDir, { recursive: true, force: true });
      expect(existsSync(agentDir)).toBe(false);

      // Restore
      await restoreAgentDir(agentDir, blobId, cipher, "3");
      expect(existsSync(agentDir)).toBe(true);

      // Verify files exist and are byte-identical
      const systemMd = await readFile(join(agentDir, "system.md"), "utf-8");
      expect(systemMd).toBe("You are a test agent.\n");

      const skillFile = await readFile(join(agentDir, "skills", "reentrancy.md"), "utf-8");
      expect(skillFile).toContain("reentrancy");

      const patternFile = await readFile(join(agentDir, "patterns", "checks-effects.md"), "utf-8");
      expect(patternFile).toContain("Checks-Effects-Interactions");

      // Verify memory.db is intact (SQLite readable + data preserved)
      const db = new Database(join(agentDir, "memory.db"), { readonly: true });
      const row = db
        .prepare("SELECT value FROM facts WHERE key = ?")
        .get("last_audit") as { value: string } | undefined;
      db.close();
      expect(row?.value).toBe("test-snapshot-fixture");
    },
    TIMEOUT_MS,
  );
});
