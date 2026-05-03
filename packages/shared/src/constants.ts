/**
 * Canonical constants — chain ids, well-known addresses, defaults.
 */

export const CHAIN_IDS = {
  zgGalileo: 16602,
  baseSepolia: 84532,
  sepolia: 11155111,
} as const;

/**
 * Parent ENS name on Sepolia (chain id 11155111). Owned by the deployer
 * wallet `0x2908209845Edd4B526B9F26E3b3bba73E9A59D10`. Each agent gets a
 * subname under this whose `addr` record points at the agent's RevenueVault
 * on Base Sepolia. Resolution is real on-chain ENS — see
 * `apps/operator/src/runtime/hermes-tools.ts:resolveAgentAddresses`.
 */
export const TICKER_PARENT = "slopstock.eth";
export const ENS_CHAIN_ID = 11_155_111;

export const HERO_AGENT = {
  ticker: "AUDIT",
  ens: "auditor.slopstock.eth",
} as const;

export const SHARE_SUPPLY = 1_000_000n * 10n ** 18n;
export const IPO_DEFAULT_ALLOCATION = 300_000n * 10n ** 18n; // 30%
