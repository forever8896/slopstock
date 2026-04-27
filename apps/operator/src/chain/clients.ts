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

export interface Clients {
  zgPublic: PublicClient;
  basePublic: PublicClient;
  zgWallet: WalletClient;
  baseWallet: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
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

  return { zgPublic, basePublic, zgWallet, baseWallet, account };
}
