/**
 * Viem clients for the chains Stratum touches.
 *
 * Read paths use public clients. Write paths (onchain effects from x402
 * payment / mint orchestration) use a wallet client built from
 * OPERATOR_PRIVATE_KEY.
 */

import { createPublicClient, createWalletClient, http, type Chain, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { OperatorConfig } from "../config.ts";

// 0G Galileo testnet — chain id 16602 (post-2026 reset). Inline for self-containment.
const zgGalileo = {
  id: 16602,
  name: "0G Galileo",
  nativeCurrency: { decimals: 18, name: "0G", symbol: "0G" },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
} as const satisfies Chain;

const baseSepolia = {
  id: 84_532,
  name: "Base Sepolia",
  nativeCurrency: { decimals: 18, name: "Sepolia Ether", symbol: "ETH" },
  rpcUrls: { default: { http: ["https://base-sepolia-rpc.publicnode.com"] } },
} as const satisfies Chain;

// Ethereum Sepolia — host of slopstock.eth + ENS PublicResolver. Used by
// query_agent to resolve `<label>.slopstock.eth` to the agent's vault, then
// match the resolved address back to a tokenId. See `resolveAgentAddresses`
// in runtime/hermes-tools.ts.
const sepolia = {
  id: 11_155_111,
  name: "Ethereum Sepolia",
  nativeCurrency: { decimals: 18, name: "Sepolia Ether", symbol: "ETH" },
  rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } },
} as const satisfies Chain;

export interface Clients {
  zgPublic: PublicClient;
  basePublic: PublicClient;
  sepoliaPublic: PublicClient;
  zgWallet: WalletClient;
  baseWallet: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
}

export interface AgentInfoCache {
  /** Read AgentRegistry.info(tokenId) on 0G and cache. Returns null if the
   *  token isn't registered. */
  forToken(tokenId: bigint): Promise<{
    shareToken: `0x${string}`;
    vaultBase: `0x${string}`;
    operator: `0x${string}`;
  } | null>;
}

export function buildAgentInfoCache(
  zgPublic: PublicClient,
  agentRegistryAddress: `0x${string}`,
): AgentInfoCache {
  const cache = new Map<string, {
    shareToken: `0x${string}`;
    vaultBase: `0x${string}`;
    operator: `0x${string}`;
  } | null>();

  return {
    async forToken(tokenId) {
      const key = tokenId.toString();
      if (cache.has(key)) return cache.get(key)!;
      try {
        const info = (await zgPublic.readContract({
          address: agentRegistryAddress,
          abi: [
            {
              type: "function",
              name: "info",
              stateMutability: "view",
              inputs: [{ name: "tokenId", type: "uint256" }],
              outputs: [
                {
                  type: "tuple",
                  components: [
                    { name: "shareToken", type: "address" },
                    { name: "vaultBase", type: "address" },
                    { name: "ensNameHash", type: "bytes32" },
                    { name: "operator", type: "address" },
                    { name: "createdAt", type: "uint64" },
                  ],
                },
              ],
            },
          ] as const,
          functionName: "info",
          args: [tokenId],
        })) as { shareToken: `0x${string}`; vaultBase: `0x${string}`; operator: `0x${string}` };
        if (info.operator === "0x0000000000000000000000000000000000000000") {
          cache.set(key, null);
          return null;
        }
        cache.set(key, info);
        return info;
      } catch {
        cache.set(key, null);
        return null;
      }
    },
  };
}

export function buildClients(config: OperatorConfig): Clients {
  const zgPublic = createPublicClient({
    chain: zgGalileo,
    transport: http(config.ZG_RPC_URL),
  });

  const basePublic = createPublicClient({
    chain: baseSepolia,
    transport: http(config.BASE_RPC_URL),
  });

  const sepoliaPublic = createPublicClient({
    chain: sepolia,
    transport: http(config.SEPOLIA_RPC_URL),
  });

  const account = privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as `0x${string}`);

  const zgWallet = createWalletClient({
    account,
    chain: zgGalileo,
    transport: http(config.ZG_RPC_URL),
  });

  const baseWallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.BASE_RPC_URL),
  });

  return { zgPublic, basePublic, sepoliaPublic, zgWallet, baseWallet, account };
}
