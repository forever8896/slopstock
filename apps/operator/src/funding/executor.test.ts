import { test, expect } from "bun:test";
import { applySlippage, resolveChainConfig, BASE_USDC, BASE_SWAP_ROUTER } from "./executor.ts";

// ── applySlippage ────────────────────────────────────────────────────────────

test("applySlippage: 1% off a round number", () => {
  expect(applySlippage(1_000_000n, 100)).toBe(990_000n); // 100 bps = 1%
});

test("applySlippage: 0 bps is a no-op (accepts exact quote)", () => {
  expect(applySlippage(1_234_567n, 0)).toBe(1_234_567n);
});

test("applySlippage: clamps negative bps to 0 (never widens past the quote)", () => {
  expect(applySlippage(1_000_000n, -50)).toBe(1_000_000n);
});

test("applySlippage: clamps >100% to 100% (min-out floors at 0)", () => {
  expect(applySlippage(1_000_000n, 999_999)).toBe(0n);
});

test("applySlippage: 50 bps (0.5%) rounds via integer math", () => {
  expect(applySlippage(2_000_000_000_000_000_000n, 50)).toBe(1_990_000_000_000_000_000n);
});

// ── resolveChainConfig ───────────────────────────────────────────────────────

test("resolveChainConfig: defaults to mainnet preset", () => {
  const c = resolveChainConfig({});
  expect(c.network).toBe("mainnet");
  expect(c.baseChainId).toBe(8453);
  expect(c.ogChainId).toBe(16661);
  expect(c.usdc).toBe(BASE_USDC);
  expect(c.swapRouter).toBe(BASE_SWAP_ROUTER);
  expect(c.baseRpcUrl).toBe("https://mainnet.base.org");
  expect(c.ogRpcUrl).toBe("https://evmrpc.0g.ai");
});

test("resolveChainConfig: SELF_FUND_NETWORK=testnet picks the Base Sepolia / 0G Galileo preset", () => {
  const c = resolveChainConfig({ SELF_FUND_NETWORK: "testnet" });
  expect(c.network).toBe("testnet");
  expect(c.baseChainId).toBe(84532);
  expect(c.ogChainId).toBe(16601);
});

test("resolveChainConfig: individual fields override the preset", () => {
  const c = resolveChainConfig({
    SELF_FUND_BASE_RPC_URL: "https://my-base-rpc.example",
    SELF_FUND_OG_RPC_URL: "https://my-og-rpc.example",
    SELF_FUND_QUOTER: "0x1111111111111111111111111111111111111111",
    SELF_FUND_POOL_FEE: "3000",
    SELF_FUND_OG_CHAIN_ID: "9999",
  });
  expect(c.network).toBe("mainnet"); // still the mainnet base preset
  expect(c.baseRpcUrl).toBe("https://my-base-rpc.example");
  expect(c.ogRpcUrl).toBe("https://my-og-rpc.example");
  expect(c.quoter).toBe("0x1111111111111111111111111111111111111111");
  expect(c.poolFee).toBe(3000);
  expect(c.ogChainId).toBe(9999);
});

test("resolveChainConfig: empty-string env values fall back to the preset", () => {
  const c = resolveChainConfig({ SELF_FUND_BASE_RPC_URL: "", SELF_FUND_POOL_FEE: "" });
  expect(c.baseRpcUrl).toBe("https://mainnet.base.org");
  expect(c.poolFee).toBe(500);
});
