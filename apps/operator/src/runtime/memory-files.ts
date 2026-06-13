import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Char caps for the frozen Layer-1 snapshots folded into the system prompt.
 *  Bounded so memory growth never blows context — Hermes Agent's "bounded,
 *  curated memory." (Real Hermes: MEMORY.md ~2200c, USER.md ~1375c.) */
export const MEMORY_MD_CAP = 4000;
export const USER_MD_CAP = 2000;

export interface FrozenMemory {
  memory: string; // MEMORY.md (capped), "" if absent
  user: string;   // USER.md (capped), "" if absent
}

/** Layer 1 of the three-layer memory: human-readable snapshots read ONCE at
 *  session start and embedded immutably in the system prompt. */
export async function loadFrozenMemory(dir: string): Promise<FrozenMemory> {
  return {
    memory: await readCapped(join(dir, "MEMORY.md"), MEMORY_MD_CAP),
    user: await readCapped(join(dir, "USER.md"), USER_MD_CAP),
  };
}

async function readCapped(path: string, cap: number): Promise<string> {
  if (!existsSync(path)) return "";
  const raw = await readFile(path, "utf-8");
  return raw.length > cap ? raw.slice(0, cap) + "\n…(truncated)" : raw;
}

/** Append a curated fact to MEMORY.md, trimming oldest bullets to stay under
 *  the cap. Called by the `note` tool so memory is BOTH queryable (SQLite) and
 *  human-readable (MEMORY.md → great for the Walrus restore demo). */
export async function appendMemoryLine(dir: string, line: string): Promise<void> {
  const path = join(dir, "MEMORY.md");
  const clean = `- ${line.replace(/\n+/g, " ").trim()}`;
  const prev = existsSync(path) ? await readFile(path, "utf-8") : "# Agent memory";
  let next = `${prev.replace(/\n+$/, "")}\n${clean}\n`;
  if (next.length > MEMORY_MD_CAP) {
    const lines = next.split("\n");
    const header = lines[0] ?? "# Agent memory";
    const body = lines.slice(1).filter((l) => l.length > 0);
    while (header.length + body.join("\n").length + 1 > MEMORY_MD_CAP && body.length > 1) {
      body.shift();
    }
    next = `${header}\n${body.join("\n")}\n`;
  }
  await writeFile(path, next, "utf-8");
}
