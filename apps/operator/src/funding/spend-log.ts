/**
 * Spend log — durable record of auto-top-up spends, used to enforce the daily
 * cap across cron runs (the operator process is not long-lived). Amounts are
 * stored as decimal strings (USDC smallest units) because JSON can't hold bigint.
 *
 * The pure window math is separated from file I/O so the daily-cap accounting —
 * the safety-critical part — is exhaustively testable.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

export interface SpendEntry {
  /** Epoch ms when the spend happened. */
  ts: number;
  /** USDC smallest units, as a decimal string. */
  amountUsdc: string;
}

/** Sum of spends strictly within (now − windowMs, now]. Edge entries excluded. */
export function spentWithinWindow(entries: SpendEntry[], now: number, windowMs: number): bigint {
  const cutoff = now - windowMs;
  let total = 0n;
  for (const e of entries) {
    if (e.ts > cutoff) total += BigInt(e.amountUsdc);
  }
  return total;
}

/** Drop entries at/older than the window so the on-disk log stays bounded. */
export function pruneOld(entries: SpendEntry[], now: number, windowMs: number): SpendEntry[] {
  const cutoff = now - windowMs;
  return entries.filter((e) => e.ts > cutoff);
}

/** File-backed spend log. One JSON array of SpendEntry. */
export class SpendLog {
  constructor(private readonly path: string, private readonly windowMs = 24 * 60 * 60 * 1000) {}

  private async read(): Promise<SpendEntry[]> {
    if (!existsSync(this.path)) return [];
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SpendEntry[]) : [];
    } catch {
      return [];
    }
  }

  async spentToday(now: number): Promise<bigint> {
    return spentWithinWindow(await this.read(), now, this.windowMs);
  }

  async record(amountUsdc: bigint, now: number): Promise<void> {
    const next = pruneOld(await this.read(), now, this.windowMs);
    next.push({ ts: now, amountUsdc: amountUsdc.toString() });
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(next, null, 2));
  }
}
