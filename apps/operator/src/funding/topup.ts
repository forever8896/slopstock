/**
 * Self-funding top-up orchestrator.
 *
 * Glues the pure policy (decideTopup) to three injected adapters so the control
 * flow is testable without moving real money, and so the dangerous on-chain
 * legs (Uniswap swap, gasZip bridge, broker deposit) live behind a single
 * `execute()` interface that can be a no-op/mock in tests and a real
 * implementation in production.
 *
 * Safety properties (covered by topup.test.ts):
 *   - never executes when the ledger is above threshold,
 *   - dry-run decides but spends nothing,
 *   - the reserve is only debited and the daily spend only recorded AFTER a
 *     successful execute (a failed bridge never moves the accounting),
 *   - all clamps (per-top-up cap, daily cap, reserve floor) flow from decideTopup.
 */

import { decideTopup } from "./policy.ts";

/** Reads the live 0G compute-ledger balance (OG smallest units). */
export interface LedgerReader {
  readLedgerOg(): Promise<bigint>;
}

/** Durable accounting for the compute reserve and the rolling daily spend. */
export interface ReserveStore {
  /** Available compute reserve accrued from payment splits (USDC smallest units). */
  getReserveUsdc(): Promise<bigint>;
  /** USDC auto-spent in the 24h window containing `now` (epoch ms). */
  getSpentTodayUsdc(now: number): Promise<bigint>;
  /** Reduce the reserve after a successful top-up. */
  debitReserveUsdc(amount: bigint): Promise<void>;
  /** Record an auto-spend against the daily window. */
  recordSpendUsdc(amount: bigint, now: number): Promise<void>;
}

/** Performs the real USDC→ETH→OG→broker top-up. Returns ok=false on any failure. */
export interface TopupExecutor {
  execute(amountUsdc: bigint): Promise<{ ok: boolean; detail: string }>;
}

export interface TopupConfig {
  thresholdOg: bigint;
  desiredTopupUsdc: bigint;
  floorUsdc: bigint;
  perTopupCapUsdc: bigint;
  dailyCapUsdc: bigint;
  /** When true, decide + log but never spend. Default posture until verified live. */
  dryRun: boolean;
}

export interface TopupDeps {
  ledger: LedgerReader;
  store: ReserveStore;
  executor: TopupExecutor;
}

export interface TopupResult {
  /** True only when real funds were moved successfully. */
  acted: boolean;
  /** True when a top-up was warranted but suppressed by dry-run. */
  dryRun?: boolean;
  amountUsdc: bigint;
  reason: string;
  detail?: string;
}

export async function runTopupCheck(cfg: TopupConfig, deps: TopupDeps, now: number): Promise<TopupResult> {
  const [ledgerOg, reserveUsdc, spentTodayUsdc] = await Promise.all([
    deps.ledger.readLedgerOg(),
    deps.store.getReserveUsdc(),
    deps.store.getSpentTodayUsdc(now),
  ]);

  const decision = decideTopup({
    ledgerOg,
    thresholdOg: cfg.thresholdOg,
    desiredTopupUsdc: cfg.desiredTopupUsdc,
    reserveUsdc,
    floorUsdc: cfg.floorUsdc,
    perTopupCapUsdc: cfg.perTopupCapUsdc,
    spentTodayUsdc,
    dailyCapUsdc: cfg.dailyCapUsdc,
  });

  if (!decision.shouldTopup) {
    return { acted: false, amountUsdc: 0n, reason: decision.reason };
  }

  if (cfg.dryRun) {
    return { acted: false, dryRun: true, amountUsdc: decision.amountUsdc, reason: `dry-run: would top up ($${fmt(decision.amountUsdc)})` };
  }

  const res = await deps.executor.execute(decision.amountUsdc);
  if (!res.ok) {
    return { acted: false, amountUsdc: decision.amountUsdc, reason: `top-up execute failed: ${res.detail}` };
  }

  // Only move the accounting after the funds actually moved.
  await deps.store.debitReserveUsdc(decision.amountUsdc);
  await deps.store.recordSpendUsdc(decision.amountUsdc, now);

  return { acted: true, amountUsdc: decision.amountUsdc, reason: "topped up the compute ledger", detail: res.detail };
}

/** USDC smallest units → human dollars, for log/reason strings. */
function fmt(usdc: bigint): string {
  const dollars = Number(usdc) / 1e6;
  return dollars.toFixed(2);
}
