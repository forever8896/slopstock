/**
 * Register an ENS subname under `slopstock.eth` for a permissionless mint.
 *
 * Flow:
 *   1. ENSRegistry.setSubnodeRecord(slopstockNode, label, owner, resolver, ttl)
 *      — creates `<ticker>.slopstock.eth` owned by the agent's creator,
 *      pointed at the canonical PublicResolver on Sepolia.
 *   2. PublicResolver.setAddr(node, vaultAddress)
 *      — addr record points at the agent's RevenueVault on Base Sepolia.
 *
 * Both txs signed by DEPLOYER_PRIVATE_KEY (same key that owns slopstock.eth).
 * Idempotent: if the subname already exists, we skip step 1 and only refresh
 * the addr record (lets us re-deploy finance without losing or breaking ENS).
 *
 * Called from /agents/:id/deploy-finance AFTER the vault is deployed —
 * that's the first moment we know the vault address to point at.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  namehash,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const SLOPSTOCK_NODE = namehash("slopstock.eth");

// Canonical Sepolia ENS Registry (same address as mainnet — ENSv2 uses one).
const ENS_REGISTRY_SEPOLIA: Hex = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
// Canonical Sepolia PublicResolver (the one our static trio's subnames use).
const PUBLIC_RESOLVER_SEPOLIA: Hex = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

const ensRegistryAbi = [
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const publicResolverAbi = [
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "addr", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

export interface RegisterSubnameOpts {
  /** Lower-case label (e.g. "whale" for "whale.slopstock.eth"). */
  ticker: string;
  /** Address the subname's `addr` record will point at — typically the vault. */
  vaultAddress: Hex;
  /** Address that owns the subname (typically the agent's creator). */
  creator: Hex;
  /** Operator's deployer key — must own slopstock.eth on Sepolia. */
  deployerKey: Hex;
  /** Sepolia RPC URL. */
  sepoliaRpcUrl: string;
}

export interface RegisterSubnameResult {
  /** Full ENS name created — e.g. "whale.slopstock.eth". */
  ensName: string;
  /** namehash of the subname (32-byte node id). */
  node: Hex;
  /** keccak256 of the label bytes. */
  labelHash: Hex;
  /** Tx hashes for the two writes (subnode creation + addr record). */
  setSubnodeTx: Hex | null;     // null when subname already existed
  setAddrTx: Hex;
  /** True if subname was created in this call vs already-existed. */
  newlyCreated: boolean;
}

/**
 * Sanitize a ticker for use as an ENS label. ENS labels must be ASCII
 * lower-case alphanumeric + hyphen; bad chars get stripped. If the result is
 * empty, throws.
 */
function sanitizeTickerForEns(ticker: string): string {
  const cleaned = ticker
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (!cleaned) throw new Error(`ticker "${ticker}" produces an empty ENS label after sanitization`);
  return cleaned;
}

export async function registerSubname(
  opts: RegisterSubnameOpts,
): Promise<RegisterSubnameResult> {
  const label = sanitizeTickerForEns(opts.ticker);
  const ensName = `${label}.slopstock.eth`;
  const labelHash = keccak256(toBytes(label));
  const node = namehash(ensName);

  const account = privateKeyToAccount(opts.deployerKey);
  const transport = http(opts.sepoliaRpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });

  // 1. Check if subname already exists.
  const currentOwner = (await publicClient.readContract({
    address: ENS_REGISTRY_SEPOLIA,
    abi: ensRegistryAbi,
    functionName: "owner",
    args: [node],
  })) as Hex;
  const ZERO: Hex = "0x0000000000000000000000000000000000000000";

  // The deployer owns slopstock.eth so it can both create the subname AND
  // (critically) update its addr record later. If we made the agent's
  // creator the subname owner, only THEY could call setAddr — the operator
  // would lose the ability to refresh the record on vault redeploys.
  // The agent's actual ownership is the iNFT on 0G Galileo; ENS here is a
  // routing artifact held by the operator.
  const deployerAddr = account.address;

  let setSubnodeTx: Hex | null = null;
  const newlyCreated = currentOwner.toLowerCase() === ZERO;
  let needsReown = !newlyCreated && currentOwner.toLowerCase() !== deployerAddr.toLowerCase();
  if (newlyCreated || needsReown) {
    setSubnodeTx = await walletClient.writeContract({
      address: ENS_REGISTRY_SEPOLIA,
      abi: ensRegistryAbi,
      functionName: "setSubnodeRecord",
      args: [SLOPSTOCK_NODE, labelHash, deployerAddr, PUBLIC_RESOLVER_SEPOLIA, 0n],
    });
    await publicClient.waitForTransactionReceipt({ hash: setSubnodeTx });
    console.log(
      `[ens-subname] ${newlyCreated ? "created" : "re-owned"} ${ensName} owner=${deployerAddr} tx=${setSubnodeTx}`,
    );
  } else {
    console.log(`[ens-subname] ${ensName} already owned by deployer, skipping setSubnodeRecord`);
  }

  // 2. Set/update the addr record to point at the vault.
  const setAddrTx = await walletClient.writeContract({
    address: PUBLIC_RESOLVER_SEPOLIA,
    abi: publicResolverAbi,
    functionName: "setAddr",
    args: [node, opts.vaultAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash: setAddrTx });
  console.log(
    `[ens-subname] ${ensName} addr → ${opts.vaultAddress} tx=${setAddrTx}`,
  );

  return {
    ensName,
    node,
    labelHash,
    setSubnodeTx,
    setAddrTx,
    newlyCreated,
  };
}
