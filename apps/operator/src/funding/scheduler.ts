/**
 * In-process self-funding scheduler.
 *
 * The operator is a long-lived process that already holds the key, the 0G
 * broker, and RPC clients — so the cheapest place to run the periodic top-up is
 * right here, on a timer. No separate Railway cron service, no env duplication.
 *
 * Weekly by default, DRY-RUN by default: it reads live balances and logs what it
 * WOULD convert (USDC → ETH → OG → ledger), moving nothing until SELF_FUND_DRY_RUN=0.
 * Every tick is wrapped so a failure (broker down, RPC blip) is logged and never
 * touches the operator's boot or request path. Disable with SELF_FUND_ENABLED=0.
 */

import { createPublicClient, http, parseEther, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { OperatorConfig } from "../config.ts";
import { getZGBroker } from "../runtime/llm-backend.ts";
import { runTopupCheck, type TopupConfig, type TopupDeps } from "./topup.ts";
import { LiveTopupExecutor, readLedgerOg, readUsdcBalance, resolveChainConfig } from "./executor.ts";
import { SpendLog } from "./spend-log.ts";

const HOUR_MS = 3_600_000;

export interface SchedulerHandle {
  stop(): void;
}

/**
 * Arm the periodic top-up. Returns null (and logs why) if disabled or the
 * operator key is missing — never throws into the boot path.
 */
export function startSelfFundingScheduler(config: OperatorConfig): SchedulerHandle | null {
  if (process.env.SELF_FUND_ENABLED === "0") {
    console.log("[self-fund] scheduler disabled (SELF_FUND_ENABLED=0)");
    return null;
  }
  const key = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    console.log("[self-fund] scheduler not started — OPERATOR_PRIVATE_KEY unset");
    return null;
  }

  const intervalHours = Math.max(1, Number(process.env.SELF_FUND_INTERVAL_HOURS ?? "168")); // weekly
  const intervalMs = intervalHours * HOUR_MS;
  const firstDelayMs = Math.max(0, Number(process.env.SELF_FUND_FIRST_DELAY_S ?? "120")) * 1000;
  const dryRun = process.env.SELF_FUND_DRY_RUN !== "0";

  // The funding loop runs on its own self-consistent chain config (mainnet by
  // default), decoupled from the app-wide BASE_RPC_URL which targets Base
  // Sepolia for x402/finance. Pick the network/RPC with SELF_FUND_* env.
  const chain = resolveChainConfig(process.env);

  const tick = async () => {
    try {
      const account = privateKeyToAccount(key);
      const base = createPublicClient({ transport: http(chain.baseRpcUrl) });
      const broker = await getZGBroker(config);
      const spendLog = new SpendLog(
        process.env.SELF_FUND_SPEND_LOG ?? `${config.AGENTS_DATA_DIR}/self-fund-spend.json`,
      );
      const executor = new LiveTopupExecutor({
        chain, account, broker,
        slippageBps: Number(process.env.SELF_FUND_SLIPPAGE_BPS ?? "100"),
      });

      const cfg: TopupConfig = {
        thresholdOg: parseEther(process.env.SELF_FUND_THRESHOLD_OG ?? "3"),
        desiredTopupUsdc: parseUnits(process.env.SELF_FUND_TOPUP_USDC ?? "5", 6),
        floorUsdc: parseUnits(process.env.SELF_FUND_FLOOR_USDC ?? "0", 6),
        perTopupCapUsdc: parseUnits(process.env.SELF_FUND_PERTOPUP_CAP_USDC ?? "20", 6),
        dailyCapUsdc: parseUnits(process.env.SELF_FUND_DAILY_CAP_USDC ?? "50", 6),
        dryRun,
      };

      const deps: TopupDeps = {
        ledger: { readLedgerOg: () => readLedgerOg(broker) },
        store: {
          getReserveUsdc: () => readUsdcBalance(base, account.address, chain.usdc),
          getSpentTodayUsdc: (now) => spendLog.spentToday(now),
          debitReserveUsdc: async () => {}, // reserve is the live USDC balance; the swap debits it
          recordSpendUsdc: (amount, now) => spendLog.record(amount, now),
        },
        executor,
      };

      const r = await runTopupCheck(cfg, deps, Date.now());
      const tag = r.acted ? "✅ TOPPED UP" : r.dryRun ? "🟡 dry-run" : "•";
      console.log(`[self-fund] tick ${tag} $${formatUnits(r.amountUsdc, 6)} — ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
    } catch (e) {
      console.warn(`[self-fund] tick failed (non-fatal): ${(e as Error).message}`);
    }
  };

  console.log(`[self-fund] scheduler armed — net=${chain.network} (base ${chain.baseChainId}→0G ${chain.ogChainId}), every ${intervalHours}h, dryRun=${dryRun}, first run in ${firstDelayMs / 1000}s`);
  const first = setTimeout(() => void tick(), firstDelayMs);
  const interval = setInterval(() => void tick(), intervalMs);
  // Don't let the timers keep the event loop alive on their own.
  if (typeof first.unref === "function") first.unref();
  if (typeof interval.unref === "function") interval.unref();

  return {
    stop() {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
}
