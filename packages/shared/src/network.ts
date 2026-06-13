/**
 * Network switch — one env var (`NETWORK=testnet|mainnet`) selects every
 * chain-specific value the stack needs. No network-baked constant names, no
 * hand-edited addresses under demo pressure.
 *
 * `resolveNetwork(env)` is pure (testable); `getNetwork()` memoizes it over
 * `process.env`. Env RPC overrides win over the baked-in defaults so a single
 * deployment can repoint an RPC without a rebuild.
 */

import { BASE_SEPOLIA_AGENTS, type AgentAddresses, type Hex } from "./addresses";

export type NetworkName = "testnet" | "mainnet";

export interface NetworkConfig {
  name: NetworkName;
  base: { chainId: number; rpcUrl: string; usdc: Hex };
  zg: { chainId: number; rpcUrl: string; computeRpcUrl: string };
  ens: { chainId: number; rpcUrl: string; registry: Hex; rootName: string };
  erc8004: { identityRegistry: Hex; reputationRegistry: Hex };
  /** `network` is the x402 v2 CAIP-2 id (e.g. "eip155:8453" | "eip155:84532"). */
  x402: { facilitatorUrl: string; network: string };
  /** Per-agent on-chain bundle, keyed by ticker. Empty until deployed. */
  agents: Record<string, AgentAddresses>;
}

// ENS Registry is the same address on every chain (mainnet + Sepolia).
const ENS_REGISTRY: Hex = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

const TESTNET: NetworkConfig = {
  name: "testnet",
  base: {
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    usdc: "0xd44e0c3a9fa12e5c00c1714b51f4d8607962e603", // our permissionless TestnetUSDC
  },
  zg: {
    chainId: 16602,
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    computeRpcUrl: "https://evmrpc-testnet.0g.ai",
  },
  ens: {
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    registry: ENS_REGISTRY,
    rootName: "slopstock.eth",
  },
  erc8004: {
    // Base Sepolia canonical ERC-8004 registries (verified on-chain: have bytecode).
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
  x402: {
    facilitatorUrl: "https://x402.org/facilitator", // keyless testnet facilitator
    network: "eip155:84532", // CAIP-2 (x402 v2)
  },
  agents: BASE_SEPOLIA_AGENTS,
};

const MAINNET: NetworkConfig = {
  name: "mainnet",
  base: {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // canonical Circle USDC
  },
  zg: {
    chainId: 16661,
    rpcUrl: "https://evmrpc.0g.ai",
    computeRpcUrl: "https://evmrpc.0g.ai",
  },
  ens: {
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    registry: ENS_REGISTRY,
    rootName: "slopstock.eth",
  },
  erc8004: {
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  x402: {
    facilitatorUrl: "https://x402.coinbase.com", // CDP facilitator (creds in .env)
    network: "eip155:8453", // CAIP-2 (x402 v2)
  },
  agents: {}, // populated at mainnet deploy; assertNetworkConfigured guards against forgetting
};

type Env = Record<string, string | undefined>;

export function resolveNetwork(env: Env): NetworkConfig {
  const raw = env["NETWORK"] ?? "testnet";
  if (raw !== "testnet" && raw !== "mainnet") {
    throw new Error(`unknown NETWORK '${raw}' (expected "testnet" or "mainnet")`);
  }
  const base = raw === "mainnet" ? MAINNET : TESTNET;

  // Env RPC overrides win over baked defaults (deep-copy so the frozen base is untouched).
  return {
    ...base,
    base: { ...base.base, rpcUrl: env["BASE_RPC_URL"] ?? base.base.rpcUrl },
    zg: {
      ...base.zg,
      rpcUrl: env["ZG_RPC_URL"] ?? base.zg.rpcUrl,
      computeRpcUrl: env["ZG_COMPUTE_RPC_URL"] ?? base.zg.computeRpcUrl,
    },
    ens: { ...base.ens, rpcUrl: env["SEPOLIA_RPC_URL"] ?? base.ens.rpcUrl },
  };
}

/**
 * Fail fast if a network is selected but not fully wired — the guard that stops
 * us going live on mainnet with a half-filled config under demo pressure.
 */
export function assertNetworkConfigured(net: NetworkConfig): void {
  if (Object.keys(net.agents).length === 0) {
    throw new Error(
      `network '${net.name}' is not configured: no agent bundle. ` +
        `Deploy agents and populate the ${net.name} bundle before running.`,
    );
  }
}

let _memo: NetworkConfig | null = null;

export function getNetwork(): NetworkConfig {
  if (!_memo) _memo = resolveNetwork(process.env);
  return _memo;
}

/** Reset memoized network (tests only). */
export function _resetNetworkForTests(): void {
  _memo = null;
}
