/**
 * HermesAgentRuntime — stateful, skill-accumulating agent runtime.
 *
 * Pattern derived from Nous Research's Hermes Agent (agentskills.io-compatible
 * skill format, three-layer memory, autonomous skill creation after complex
 * tasks). We don't shell out to the upstream Python binary — we implement
 * the same pattern natively in TypeScript so the operator stays a single
 * Bun process. Honest framing in docs: we are "Hermes-pattern" not "literally
 * running Hermes."
 *
 * On-disk layout (under AGENTS_DATA_DIR/<tokenId>/):
 *
 *   skills/
 *     reentrancy.md
 *     access-control.md
 *     ...
 *   patterns/                  — read-only known-pattern library (shared)
 *   memory.db                  — SQLite (FTS5) — messages, facts, task_log
 *   system.md                  — agent system prompt
 *   bundle.lock.json           — { bundleHash, version, lastUpdated }
 *
 * Lifecycle:
 *
 *   load(tokenId)        — ensure dir exists, init memory.db schema, hydrate
 *                          system prompt + skill list. Idempotent.
 *   runTask(req)         — implemented in this file's task loop (see
 *                          task #35 follow-up). Today: stub that returns
 *                          a single-LLM-call result with a real bundle hash.
 *   bundleHash(tokenId)  — hash the on-disk bundle deterministically.
 */

import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { keccak256, toHex } from "viem";
import type { Hex } from "@stratum/shared";
import type { AgentStep } from "@stratum/shared";
import type { OperatorConfig } from "../config.ts";
import { hashBundleDir, stateDeltaHash } from "./bundle.ts";
import { measurementForToken } from "./measurement.ts";
import { RuntimeError, type AgentRuntime, type AgentTaskInput, type AgentTaskOutput } from "./types.ts";

const SEED_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../seed/agents");

const DEFAULT_SYSTEM_PROMPT = `You are a Hermes-pattern Solidity security agent.

You receive Solidity source code from a paying subscriber. Your job is to find
security issues, with the help of tools and the skill set you've accumulated
from previous audits. You think in steps, call tools, observe, and revise.

Output format: ONE final JSON object, schema:
{
  "summary": "<one-line gist>",
  "findings": [{
    "id": "AUDIT-NNN",
    "severity": "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL",
    "title": "<short title>",
    "location": { "file": "input.sol", "lines": [<start>, <end>] },
    "description": "<why; 1-3 sentences>",
    "recommendation": "<concrete fix; 1-2 sentences>"
  }],
  "summaryStats": { "high": <n>, "medium": <n>, "low": <n>, "informational": <n> },
  "modelMeta": { "model": "<model>", "version": "stratum-audit-v1" }
}

You may call tools by emitting a JSON object with a "tool" field instead of
the final answer. The runtime will execute the tool and feed you the result.

When you've gathered enough evidence, emit the final JSON. Do not wrap in
markdown.`;

interface BundleLock {
  bundleHash: Hex;
  version: number;
  lastUpdated: number;
}

interface AgentState {
  dir: string;
  db: Database;
  systemPrompt: string;
  skills: SkillDoc[];
  lock: BundleLock;
}

export interface SkillDoc {
  name: string;       // filename stem
  filename: string;   // skills/<name>.md
  frontmatter: Record<string, string>;
  body: string;       // Markdown body
}

export class HermesAgentRuntime implements AgentRuntime {
  readonly kind = "hermes" as const;

  private readonly stateByToken = new Map<string, AgentState>();
  /** Lazily-imported once the loop module is built. */
  private loop?: typeof import("./hermes-loop.ts");

  constructor(private readonly config: OperatorConfig) {}

  async load(opts: { tokenId: bigint }): Promise<void> {
    const key = opts.tokenId.toString();
    if (this.stateByToken.has(key)) return;

    const dir = this.dirFor(opts.tokenId);
    await mkdir(join(dir, "skills"), { recursive: true });
    await mkdir(join(dir, "patterns"), { recursive: true });

    // First-run seeding: if a seed bundle exists for this tokenId under
    // apps/operator/seed/agents/<tokenId>/, copy any files we don't already
    // have on disk. Lets us check in starter system.md / patterns / skills
    // without conflating them with runtime state.
    const seedDir = join(SEED_ROOT, key);
    if (existsSync(seedDir)) {
      await cp(seedDir, dir, { recursive: true, force: false, errorOnExist: false });
    }

    // System prompt
    const sysPath = join(dir, "system.md");
    if (!existsSync(sysPath)) {
      await writeFile(sysPath, DEFAULT_SYSTEM_PROMPT);
    }
    const systemPrompt = await readFile(sysPath, "utf-8");

    // Memory DB
    const dbPath = join(dir, "memory.db");
    const db = new Database(dbPath, { create: true });
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        ts    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_log (
        callId    TEXT PRIMARY KEY,
        tokenId   TEXT NOT NULL,
        subscriber TEXT NOT NULL,
        ts        INTEGER NOT NULL,
        summary   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_log_token_ts ON task_log(tokenId, ts DESC);
    `);
    // Best-effort FTS5 messages table — older bun builds may not bundle FTS5.
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(callId, role, content, ts UNINDEXED);`);
    } catch {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          callId TEXT NOT NULL,
          role   TEXT NOT NULL,
          content TEXT NOT NULL,
          ts     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_call ON messages(callId);
      `);
    }

    // Skills
    const skills = await loadSkills(dir);

    // Bundle lock
    const lockPath = join(dir, "bundle.lock.json");
    const bundleHash = await hashBundleDir(dir);
    let lock: BundleLock;
    if (existsSync(lockPath)) {
      lock = JSON.parse(await readFile(lockPath, "utf-8")) as BundleLock;
      lock.bundleHash = bundleHash;
      lock.lastUpdated = Date.now();
    } else {
      lock = { bundleHash, version: 1, lastUpdated: Date.now() };
    }
    await writeFile(lockPath, JSON.stringify(lock, null, 2));

    this.stateByToken.set(key, { dir, db, systemPrompt, skills, lock });
  }

  async bundleHash(tokenId: bigint): Promise<Hex> {
    return hashBundleDir(this.dirFor(tokenId));
  }

  async runTask(req: AgentTaskInput): Promise<AgentTaskOutput> {
    const state = this.stateByToken.get(req.tokenId.toString());
    if (!state) throw new RuntimeError(`runtime not loaded for tokenId ${req.tokenId}`);

    if (!this.loop) {
      this.loop = await import("./hermes-loop.ts");
    }
    const result = await this.loop.runAgentLoop({
      config: this.config,
      state,
      req,
    });

    // Compute new bundle hash AFTER the loop has had a chance to write
    // skills / memory back to disk.
    const bundleHashBefore = state.lock.bundleHash;
    const bundleHashAfter = await hashBundleDir(state.dir);
    state.lock.bundleHash = bundleHashAfter;
    state.lock.version += bundleHashBefore === bundleHashAfter ? 0 : 1;
    state.lock.lastUpdated = Date.now();
    await writeFile(
      join(state.dir, "bundle.lock.json"),
      JSON.stringify(state.lock, null, 2),
    );

    const inputBytes = new TextEncoder().encode(req.input);
    const outputBytes = new TextEncoder().encode(result.output);

    return {
      output: result.output,
      inputHash: keccak256(toHex(inputBytes)),
      outputHash: keccak256(toHex(outputBytes)),
      transcript: result.transcript,
      bundleHashBefore,
      bundleHashAfter,
      stateDeltaHash: stateDeltaHash(bundleHashBefore, bundleHashAfter),
      skillsLoaded: result.skillsLoaded,
      skillsCreated: result.skillsCreated,
      measurement: measurementForToken(req.tokenId),
      teeQuote: Buffer.from(
        `stratum-testnet-no-tee-quote:runtime=hermes:tokenId=${req.tokenId}:bundle=${bundleHashAfter}:ts=${Date.now()}`,
      ).toString("base64"),
      teeVendor: "intel-tdx",
      model: result.model,
      ts: Math.floor(Date.now() / 1000),
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private dirFor(tokenId: bigint): string {
    return join(this.config.AGENTS_DATA_DIR, tokenId.toString());
  }
}

/** Read every Markdown file under <dir>/skills/, parse frontmatter. */
async function loadSkills(dir: string): Promise<SkillDoc[]> {
  const skillsDir = join(dir, "skills");
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }
  const out: SkillDoc[] = [];
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const raw = await readFile(join(skillsDir, f), "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const name = f.replace(/\.md$/, "");
    out.push({ name, filename: `skills/${f}`, frontmatter, body });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse `---\nkey: value\n---\nbody` style frontmatter. Tolerates missing. */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw.trim() };
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key) fm[key] = value;
  }
  return { frontmatter: fm, body: (m[2] ?? "").trim() };
}
