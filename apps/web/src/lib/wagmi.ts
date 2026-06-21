import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { rainbowWallet, metaMaskWallet, walletConnectWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { base, baseSepolia, sepolia } from "wagmi/chains";
import { http, fallback, type Chain } from "viem";

/**
 * 0G Galileo — chain id 16602 (was 16601 pre-2026 reset). EVM-compatible but
 * not in viem's bundled chain registry, so declared inline.
 */
export const zgGalileo = {
  id: 16602,
  name: "0G Galileo",
  nativeCurrency: { decimals: 18, name: "0G", symbol: "0G" },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
} as const satisfies Chain;

/**
 * RainbowKit + wagmi config. The default Base Sepolia RPC (`sepolia.base.org`)
 * 502s frequently, so we fall back to publicnode + tenderly.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "Stratum",
  projectId: process.env["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"] ?? "stratum-dev",
  // Explicit wallet list (overrides the default) so the Base Account wallet is
  // never built — it pulls @base-org/account whose nested noble-2.x breaks the
  // build (also aliased out in next.config). getDefaultConfig keeps SSR-safe storage.
  wallets: [
    { groupName: "Popular", wallets: [rainbowWallet, metaMaskWallet, walletConnectWallet, injectedWallet] },
  ],
  chains: [base, zgGalileo, baseSepolia, sepolia],
  transports: {
    [base.id]: fallback([http("https://mainnet.base.org"), http()]),
    [zgGalileo.id]: http(),
    [baseSepolia.id]: fallback([
      http("https://base-sepolia-rpc.publicnode.com"),
      http("https://base-sepolia.gateway.tenderly.co"),
      http(),
    ]),
    [sepolia.id]: http(),
  },
  ssr: true,
});
