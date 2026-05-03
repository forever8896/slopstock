/**
 * Server-side viem public clients. Used by Server Components / loaders that
 * read on-chain state. Wallet writes happen in Client Components via wagmi.
 */

import { createPublicClient, http, type Chain } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { ZG_GALILEO } from "@stratum/shared";

export const zgGalileoChain = {
  id: ZG_GALILEO.chainId,
  name: "0G Galileo",
  nativeCurrency: { decimals: 18, name: "0G", symbol: "0G" },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: { default: { name: "0G Explorer", url: "https://chainscan-galileo.0g.ai" } },
  testnet: true,
} as const satisfies Chain;

export const zgPublicClient = createPublicClient({
  chain: zgGalileoChain,
  transport: http(),
});

// Server-side reads use publicnode directly (sepolia.base.org 502s frequently).
// Browser writes go through wagmi's fallback chain in lib/wagmi.ts.
export const basePublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

// Ethereum Sepolia — host of `slopstock.eth` and the ENS PublicResolver.
// Used by `verifyEns()` to do real on-chain ENS resolution at SSR time.
export const sepoliaPublicClient = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
});
