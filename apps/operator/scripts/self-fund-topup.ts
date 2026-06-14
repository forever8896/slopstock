/**
 * Self-funding top-up — cron entrypoint.
 *
 * Reads the live 0G compute-ledger balance and the operator's accrued USDC
 * reserve (the compute slice skimmed from x402 payments), and — when the ledger
 * is low and all caps allow — converts a slice of that USDC into OG and deposits
 * it into the ledger so the agent keeps running on its own earnings.
 *
 *   USDC (Base) → ETH (Uniswap V3) → OG (gas.zip via LI.FI) → broker ledger
 *
 * SAFE BY DEFAULT: dry-run unless SELF_FUND_DRY_RUN=0. In dry-run it reads live
 * balances and logs exactly what it WOULD do, moving nothing. Wire it to cron:
 *
 *   */15 * * * *  cd /app && bun run apps/operator/scripts/self-fund-topup.ts
 *
 * Required env: OPERATOR_PRIVATE_KEY, NETWORK=mainnet, ZG_* / BASE_RPC_URL.
 * Tunables (human units): SELF_FUND_THRESHOLD_OG, SELF_FUND_TOPUP_USDC,
 *   SELF_FUND_PERTOPUP_CAP_USDC, SELF_FUND_DAILY_CAP_USDC, SELF_FUND_FLOOR_USDC,
 *   SELF_FUND_SLIPPAGE_BPS, SELF_FUND_SPEND_LOG.
 */

import { createPublicClient, http, parseEther, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.ts";
import { getZGBroker } from "../src/runtime/llm-backend.ts";
import { runTopupCheck, type TopupConfig, type TopupDeps } from "../src/funding/topup.ts";
import { LiveTopupExecutor, readLedgerOg, readUsdcBalance } from "../src/funding/executor.ts";
import { SpendLog } from "../src/funding/spend-log.ts";

function envOg(name: string, dflt: string): bigint { return parseEther(process.env[name] ?? dflt); }
function envUsdc(name: string, dflt: string): bigint { return parseUnits(process.env[name] ?? dflt, 6); }

async function main() {
  const dryRun = process.env.SELF_FUND_DRY_RUN !== "0"; // default ON
  const key = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) { console.error("[self-fund] OPERATOR_PRIVATE_KEY not set"); process.exit(1); }
  const account = privateKeyToAccount(key);

  const config = loadConfig();
  const baseRpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const base = createPublicClient({ transport: http(baseRpcUrl) });
  const broker = await getZGBroker(config);

  const cfg: TopupConfig = {
    thresholdOg: envOg("SELF_FUND_THRESHOLD_OG", "3"),
    desiredTopupUsdc: envUsdc("SELF_FUND_TOPUP_USDC", "5"),
    floorUsdc: envUsdc("SELF_FUND_FLOOR_USDC", "0"),
    perTopupCapUsdc: envUsdc("SELF_FUND_PERTOPUP_CAP_USDC", "20"),
    dailyCapUsdc: envUsdc("SELF_FUND_DAILY_CAP_USDC", "50"),
    dryRun,
  };

  const spendLog = new SpendLog(process.env.SELF_FUND_SPEND_LOG ?? "data/self-fund-spend.json");
  const executor = new LiveTopupExecutor({
    baseRpcUrl, account, broker,
    slippageBps: Number(process.env.SELF_FUND_SLIPPAGE_BPS ?? "100"),
  });

  const deps: TopupDeps = {
    ledger: { readLedgerOg: () => readLedgerOg(broker) },
    store: {
      getReserveUsdc: () => readUsdcBalance(base, account.address),
      getSpentTodayUsdc: (now) => spendLog.spentToday(now),
      debitReserveUsdc: async () => {}, // reserve is the live on-chain USDC balance; the swap debits it
      recordSpendUsdc: (amount, now) => spendLog.record(amount, now),
    },
    executor,
  };

  const [ledgerOg, reserveUsdc] = await Promise.all([deps.ledger.readLedgerOg(), deps.store.getReserveUsdc()]);
  console.log(`[self-fund] wallet=${account.address} dryRun=${dryRun}`);
  console.log(`[self-fund] ledger=${formatUnits(ledgerOg, 18)} OG (threshold ${formatUnits(cfg.thresholdOg, 18)}) | reserve=$${formatUnits(reserveUsdc, 6)} USDC`);

  const result = await runTopupCheck(cfg, deps, Date.now());
  const tag = result.acted ? "✅ TOPPED UP" : result.dryRun ? "🟡 DRY-RUN" : "•";
  console.log(`[self-fund] ${tag} amount=$${formatUnits(result.amountUsdc, 6)} — ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
  process.exit(0);
}

main().catch((e) => { console.error("[self-fund] error:", e); process.exit(1); });
