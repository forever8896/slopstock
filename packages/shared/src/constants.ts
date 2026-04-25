/**
 * Canonical constants — chain ids, well-known addresses, defaults.
 */

export const CHAIN_IDS = {
  zgGalileo: 16601,
  baseSepolia: 84532,
  sepolia: 11155111,
} as const;

export const TICKER_PARENT = "stratum.eth";

export const HERO_AGENT = {
  ticker: "AUDIT",
  ens: "auditor.stratum.eth",
} as const;

export const SHARE_SUPPLY = 1_000_000n * 10n ** 18n;
export const IPO_DEFAULT_ALLOCATION = 300_000n * 10n ** 18n; // 30%
