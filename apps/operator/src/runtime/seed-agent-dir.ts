import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Seed a launched agent's system prompt to <dataDir>/<tokenId>/system.md.
 *  Idempotent + non-destructive: never overwrites an existing system.md, so a
 *  self-improved prompt survives. Hermes load() reads this file if present. */
export async function seedAgentSystemPrompt(dataDir: string, tokenId: bigint, systemPrompt: string): Promise<void> {
  const dir = join(dataDir, tokenId.toString());
  await mkdir(dir, { recursive: true });
  const sysPath = join(dir, "system.md");
  if (!existsSync(sysPath)) await writeFile(sysPath, systemPrompt);
}
