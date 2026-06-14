import { test, expect } from "bun:test";
import { readSplitConfig, resolvePayTo } from "./split-config.ts";

const VAULT = "0x1c1fa59c0b6e631a47c7ec4717af3a0b7bfdb382" as const;
const RESERVE = "0xAf2883b5F08298aaFD268552732250e10e71f414" as const;

test("default (no env) → split disabled, payTo stays the vault", () => {
  const cfg = readSplitConfig({});
  expect(cfg.enabled).toBe(false);
  expect(cfg.sliceBps).toBe(0);
  expect(cfg.reserveAddress).toBeNull();
  expect(resolvePayTo(VAULT, cfg)).toBe(VAULT);
});

test("bps + valid reserve address → enabled, payTo becomes the reserve", () => {
  const cfg = readSplitConfig({ COMPUTE_SLICE_BPS: "1500", COMPUTE_RESERVE_ADDRESS: RESERVE });
  expect(cfg.enabled).toBe(true);
  expect(cfg.sliceBps).toBe(1500);
  expect(resolvePayTo(VAULT, cfg)).toBe(RESERVE);
});

test("bps set but no address → stays disabled (no accidental misroute)", () => {
  const cfg = readSplitConfig({ COMPUTE_SLICE_BPS: "1500" });
  expect(cfg.enabled).toBe(false);
  expect(resolvePayTo(VAULT, cfg)).toBe(VAULT);
});

test("out-of-range or zero bps → disabled", () => {
  expect(readSplitConfig({ COMPUTE_SLICE_BPS: "0", COMPUTE_RESERVE_ADDRESS: RESERVE }).enabled).toBe(false);
  expect(readSplitConfig({ COMPUTE_SLICE_BPS: "20000", COMPUTE_RESERVE_ADDRESS: RESERVE }).enabled).toBe(false);
});

test("malformed reserve address → disabled", () => {
  const cfg = readSplitConfig({ COMPUTE_SLICE_BPS: "1500", COMPUTE_RESERVE_ADDRESS: "0xnope" });
  expect(cfg.enabled).toBe(false);
});
