import { test, expect } from "bun:test";
import { runTopupCheck, type TopupDeps, type TopupConfig } from "./topup.ts";

const CFG: TopupConfig = {
  thresholdOg: 10n,
  desiredTopupUsdc: 20_000_000n, // $20
  floorUsdc: 0n,
  perTopupCapUsdc: 50_000_000n,
  dailyCapUsdc: 100_000_000n,
  dryRun: false,
};

function deps(over: Partial<{
  ledgerOg: bigint; reserveUsdc: bigint; spentTodayUsdc: bigint; execOk: boolean;
}> = {}) {
  const calls = { executed: [] as bigint[], debited: [] as bigint[], recorded: [] as bigint[] };
  const d: TopupDeps = {
    ledger: { readLedgerOg: async () => over.ledgerOg ?? 1n },
    store: {
      getReserveUsdc: async () => over.reserveUsdc ?? 1_000_000_000n,
      getSpentTodayUsdc: async () => over.spentTodayUsdc ?? 0n,
      debitReserveUsdc: async (a) => { calls.debited.push(a); },
      recordSpendUsdc: async (a) => { calls.recorded.push(a); },
    },
    executor: {
      execute: async (a) => { calls.executed.push(a); return { ok: over.execOk ?? true, detail: "ok" }; },
    },
  };
  return { d, calls };
}

const NOW = 1_700_000_000_000;

test("ledger above threshold → no action, executor untouched", async () => {
  const { d, calls } = deps({ ledgerOg: 10n });
  const r = await runTopupCheck(CFG, d, NOW);
  expect(r.acted).toBe(false);
  expect(calls.executed).toEqual([]);
});

test("dry-run: decides to top up but spends nothing", async () => {
  const { d, calls } = deps();
  const r = await runTopupCheck({ ...CFG, dryRun: true }, d, NOW);
  expect(r.acted).toBe(false);
  expect(r.dryRun).toBe(true);
  expect(r.amountUsdc).toBe(20_000_000n);
  expect(calls.executed).toEqual([]); // no swap/bridge
  expect(calls.debited).toEqual([]); // no reserve change
  expect(calls.recorded).toEqual([]); // no daily-spend change
});

test("live: executes, debits reserve, records daily spend", async () => {
  const { d, calls } = deps();
  const r = await runTopupCheck(CFG, d, NOW);
  expect(r.acted).toBe(true);
  expect(r.amountUsdc).toBe(20_000_000n);
  expect(calls.executed).toEqual([20_000_000n]);
  expect(calls.debited).toEqual([20_000_000n]);
  expect(calls.recorded).toEqual([20_000_000n]);
});

test("executor failure → no debit, no spend recorded, acted=false", async () => {
  const { d, calls } = deps({ execOk: false });
  const r = await runTopupCheck(CFG, d, NOW);
  expect(r.acted).toBe(false);
  expect(r.reason).toContain("failed");
  expect(calls.executed).toEqual([20_000_000n]); // attempted
  expect(calls.debited).toEqual([]); // but not debited
  expect(calls.recorded).toEqual([]);
});

test("caps flow through: daily allowance clamps the live spend", async () => {
  const { d, calls } = deps({ spentTodayUsdc: 90_000_000n });
  const r = await runTopupCheck(CFG, d, NOW); // $10 left today
  expect(r.acted).toBe(true);
  expect(calls.executed).toEqual([10_000_000n]);
});
