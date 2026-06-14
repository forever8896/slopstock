import { test, expect, afterEach } from "bun:test";
import { startSelfFundingScheduler } from "./scheduler.ts";
import type { OperatorConfig } from "../config.ts";

const cfg = {} as OperatorConfig;
const orig = { ...process.env };
afterEach(() => {
  process.env = { ...orig };
});

test("scheduler is inert when SELF_FUND_ENABLED=0 (returns null, arms nothing)", () => {
  process.env.SELF_FUND_ENABLED = "0";
  expect(startSelfFundingScheduler(cfg)).toBeNull();
});

test("scheduler does not start without an operator key", () => {
  delete process.env.SELF_FUND_ENABLED;
  delete process.env.OPERATOR_PRIVATE_KEY;
  expect(startSelfFundingScheduler(cfg)).toBeNull();
});
