import { test, expect } from "bun:test";
import { computeSplit, decideTopup } from "./policy.ts";

// ── computeSplit: carve a compute slice off an inbound payment ──────────────
test("computeSplit takes the bps slice and leaves the net", () => {
  // 1 USDC (6dp) at 1500 bps = 15%
  expect(computeSplit(1_000_000n, 1500)).toEqual({ computeSlice: 150_000n, net: 850_000n });
});

test("computeSplit floors the slice (integer math) and never loses a unit", () => {
  // 1 smallest unit at 15% → slice rounds down to 0, net keeps the unit
  expect(computeSplit(1n, 1500)).toEqual({ computeSlice: 0n, net: 1n });
  // slice + net always == amount
  const { computeSlice, net } = computeSplit(333_333n, 1234);
  expect(computeSlice + net).toBe(333_333n);
});

test("computeSplit with 0 bps keeps everything as net", () => {
  expect(computeSplit(5_000_000n, 0)).toEqual({ computeSlice: 0n, net: 5_000_000n });
});

test("computeSplit rejects out-of-range bps", () => {
  expect(() => computeSplit(1n, -1)).toThrow();
  expect(() => computeSplit(1n, 10_001)).toThrow();
});

// ── decideTopup: when to spend the reserve to refill the 0G compute ledger ──
const BASE = {
  ledgerOg: 1n, // far below threshold by default
  thresholdOg: 10n,
  desiredTopupUsdc: 20_000_000n, // $20
  reserveUsdc: 1_000_000_000n, // $1000 reserve
  floorUsdc: 0n,
  perTopupCapUsdc: 50_000_000n, // $50
  spentTodayUsdc: 0n,
  dailyCapUsdc: 100_000_000n, // $100/day
};

test("no top-up when the ledger is at/above threshold", () => {
  const d = decideTopup({ ...BASE, ledgerOg: 10n });
  expect(d.shouldTopup).toBe(false);
  expect(d.amountUsdc).toBe(0n);
});

test("tops up the desired amount when below threshold and within all caps", () => {
  const d = decideTopup(BASE);
  expect(d.shouldTopup).toBe(true);
  expect(d.amountUsdc).toBe(20_000_000n);
});

test("per-topup cap clamps the amount", () => {
  const d = decideTopup({ ...BASE, desiredTopupUsdc: 80_000_000n, perTopupCapUsdc: 50_000_000n });
  expect(d.amountUsdc).toBe(50_000_000n);
});

test("daily cap clamps to remaining daily allowance", () => {
  const d = decideTopup({ ...BASE, spentTodayUsdc: 90_000_000n, dailyCapUsdc: 100_000_000n });
  expect(d.amountUsdc).toBe(10_000_000n); // only $10 left today
});

test("daily cap fully spent → no top-up", () => {
  const d = decideTopup({ ...BASE, spentTodayUsdc: 100_000_000n, dailyCapUsdc: 100_000_000n });
  expect(d.shouldTopup).toBe(false);
  expect(d.reason).toContain("daily");
});

test("reserve floor is never breached", () => {
  // reserve $25, floor $20 → only $5 spendable, clamps below desired $20
  const d = decideTopup({ ...BASE, reserveUsdc: 25_000_000n, floorUsdc: 20_000_000n });
  expect(d.amountUsdc).toBe(5_000_000n);
});

test("reserve at floor → no top-up", () => {
  const d = decideTopup({ ...BASE, reserveUsdc: 20_000_000n, floorUsdc: 20_000_000n });
  expect(d.shouldTopup).toBe(false);
  expect(d.reason).toContain("reserve");
});
