/**
 * Deployed contract addresses on each Stratum chain.
 *
 * Sourced from /contracts/deployments/*.json. Update this file when redeploying
 * (a small generator script could automate this; for hackathon scope it's hand-
 * maintained alongside the deploys).
 */

export type Hex = `0x${string}`;

export const ZG_GALILEO = {
  chainId: 16602,
  agentNft: "0x2F79b1950CcaA58259ea62bFe99107De75018D92" as Hex,
  usdc: "0x5190f454E058319C53c82ff8bDaF0CB193CA8109" as Hex,
  marketplace: "0x2A06246eeaf9b772CD3e7B8823298c0C8E89df48" as Hex,
  fractionalizer: "0x5C2Ca0331EaEC7EB272e044579EB2C28EFBC819e" as Hex,
  agentRegistry: "0x7c9b6C415131414dc4b55E24aB2aE0a31439a290" as Hex,
} as const;

/** Circle-issued USDC on Base Sepolia. */
export const USDC_BASE_SEPOLIA: Hex = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export interface AgentAddresses {
  tokenId: bigint;
  shareToken: Hex;
  revenueVault: Hex;
  ipoSale: Hex;
  ensName: string;
}

/**
 * Per-agent Base-side bundle. Keyed by ticker.
 */
export const BASE_SEPOLIA_AGENTS: Record<string, AgentAddresses> = {
  AUDIT: {
    tokenId: 1n,
    shareToken: "0x2F79b1950CcaA58259ea62bFe99107De75018D92",
    revenueVault: "0x5190f454E058319C53c82ff8bDaF0CB193CA8109",
    ipoSale: "0x2A06246eeaf9b772CD3e7B8823298c0C8E89df48",
    ensName: "auditor.stratum.eth",
  },
};

export function getAgent(ticker: string): AgentAddresses {
  const agent = BASE_SEPOLIA_AGENTS[ticker.toUpperCase()];
  if (!agent) throw new Error(`unknown agent ticker: ${ticker}`);
  return agent;
}
