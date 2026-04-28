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
  agentNft: "0x96BDA325345b0c8b7946567D30648cf8a422eb59" as Hex,
  usdc: "0x1F2147265b104DE7b5f2C496cD19817cD8659e98" as Hex,
  marketplace: "0x0f33F116992C6C470BB3bD7cC72Cf6891c84b1d5" as Hex,
  fractionalizer: "0x4a0a6166105e90490EF9918019712d24252c0A5A" as Hex,
  agentRegistry: "0xB5d78dF01Fc1969A082073f6d16acaB916FACab5" as Hex,
} as const;

/** Circle-issued USDC on Base Sepolia. */
export const USDC_BASE_SEPOLIA: Hex = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export interface AgentAddresses {
  tokenId: bigint;
  shareToken: Hex;
  revenueVault: Hex;
  ipoSale: Hex;
  ensName: string;
  /** Base Sepolia block at which the per-agent bundle was deployed. Used as
   *  the lower bound for log scans (RPCs cap getLogs ranges at ~50k blocks). */
  baseDeployBlock: bigint;
  /** Which AgentRuntime adapter this agent's operator is expected to run.
   *  The protocol layer doesn't enforce this — it's a hint to the UI and
   *  to operators. Different agents can run different runtimes. */
  runtime: "hermes" | "openai-compat";
}

/**
 * Per-agent Base-side bundle. Keyed by ticker.
 */
export const BASE_SEPOLIA_AGENTS: Record<string, AgentAddresses> = {
  AUDIT: {
    tokenId: 1n,
    shareToken: "0xC257DEe33f2a709aA72Acb4Da2f657C4eb7DC0Fa",
    revenueVault: "0x01667C0D76b84d6cd63C82500141340bAf0c18ce",
    ipoSale: "0x4563a1F9Ba44C226bb378Ed33aC997CcB423D45d",
    ensName: "auditor.stratum.eth",
    baseDeployBlock: 40776566n,
    runtime: "hermes",
  },
  MEMER: {
    tokenId: 2n,
    shareToken: "0x1F2147265b104DE7b5f2C496cD19817cD8659e98",
    revenueVault: "0x0f33F116992C6C470BB3bD7cC72Cf6891c84b1d5",
    ipoSale: "0x4a0a6166105e90490EF9918019712d24252c0A5A",
    ensName: "memer.stratum.eth",
    baseDeployBlock: 40815273n,
    runtime: "openai-compat",
  },
};

export function getAgent(ticker: string): AgentAddresses {
  const agent = BASE_SEPOLIA_AGENTS[ticker.toUpperCase()];
  if (!agent) throw new Error(`unknown agent ticker: ${ticker}`);
  return agent;
}
