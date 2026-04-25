import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, sepolia } from "wagmi/chains";
import { http, type Chain } from "viem";

/**
 * 0G Galileo — chain id 16601, EVM-compatible. Not in viem's bundled chain
 * registry (yet), so we declare it inline.
 */
export const zgGalileo = {
  id: 16601,
  name: "0G Galileo",
  nativeCurrency: { decimals: 18, name: "0G", symbol: "0G" },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
} as const satisfies Chain;

/**
 * RainbowKit + wagmi config. WALLETCONNECT_PROJECT_ID falls back to a literal
 * sentinel for local dev — RainbowKit will warn but still render.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "Stratum",
  projectId: process.env["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"] ?? "stratum-dev",
  chains: [zgGalileo, baseSepolia, sepolia],
  transports: {
    [zgGalileo.id]: http(),
    [baseSepolia.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});
