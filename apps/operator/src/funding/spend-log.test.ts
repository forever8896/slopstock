import { test, expect } from "bun:test";
import { spentWithinWindow, pruneOld, type SpendEntry } from "./spend-log.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

test("spentWithinWindow sums only entries inside the rolling window", () => {
  const entries: SpendEntry[] = [
    { ts: NOW - 2 * DAY, amountUsdc: "5000000" }, // 2d ago — outside
    { ts: NOW - DAY + 1000, amountUsdc: "3000000" }, // just inside 24h
    { ts: NOW - 1000, amountUsdc: "2000000" }, // recent
  ];
  expect(spentWithinWindow(entries, NOW, DAY)).toBe(5_000_000n);
});

test("spentWithinWindow is 0 with no recent entries", () => {
  const entries: SpendEntry[] = [{ ts: NOW - 5 * DAY, amountUsdc: "9000000" }];
  expect(spentWithinWindow(entries, NOW, DAY)).toBe(0n);
});

test("boundary: an entry exactly at the window edge is excluded", () => {
  const entries: SpendEntry[] = [{ ts: NOW - DAY, amountUsdc: "1000000" }];
  expect(spentWithinWindow(entries, NOW, DAY)).toBe(0n);
});

test("pruneOld drops entries older than the window (keeps the log bounded)", () => {
  const entries: SpendEntry[] = [
    { ts: NOW - 3 * DAY, amountUsdc: "1" },
    { ts: NOW - 1000, amountUsdc: "2" },
  ];
  expect(pruneOld(entries, NOW, DAY)).toEqual([{ ts: NOW - 1000, amountUsdc: "2" }]);
});
