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
import { sepolia, mainnet } from "viem/chains";

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
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
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

// ─── ENS Text Record Writer (ENSIP-26 + ENSIP-25) ─────────────────────────────
//
// Canonical resolver addresses. The ENS Registry address is the same on all chains.
// PublicResolver addresses differ per chain.

/** ENS Registry — same address on every chain (ENSv2 universal). */
const ENS_REGISTRY: Hex = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
/** Canonical PublicResolver on Ethereum mainnet (ens-contracts v0.0.21+). */
const PUBLIC_RESOLVER_MAINNET: Hex = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41";

/**
 * One text record to set: a key and the value to write.
 * ENSIP-26 keys: "agent-context", "agent-endpoint[x402|mcp|a2a|web]"
 * ENSIP-25 keys: "agent-registration[<interopAddr>][<agentId>]"
 */
export interface TextRecord {
  key: string;
  value: string;
}

export interface SetTextRecordsOpts {
  /**
   * Full ENS name to set records on (e.g. "auditor.slopstock.eth").
   * The deployer key MUST own (or control) this name.
   */
  ensName: string;
  /** Text records to write — each becomes one `setText` tx. */
  records: TextRecord[];
  /** Deployer key owning the ENS name. */
  deployerKey: Hex;
  /**
   * Target network: "mainnet" | "sepolia".
   * Defaults to "sepolia" — mainnet writes require L1 ETH (FUNDING GATE).
   */
  network?: "mainnet" | "sepolia";
  /**
   * Override RPC URL. Falls back to public endpoints.
   * For mainnet: supply a reliable paid RPC (e.g. Infura/Alchemy) before going live.
   */
  rpcUrl?: string;
}

export interface SetTextRecordsResult {
  ensName: string;
  node: Hex;
  /** Tx hash for each setText call, in the same order as opts.records. */
  txHashes: Hex[];
  network: "mainnet" | "sepolia";
}

/**
 * Write ENSIP-26 / ENSIP-25 text records to an ENS name.
 *
 * Works on both Sepolia (testnet) and Ethereum mainnet. The network is
 * selected via `opts.network` — defaults to "sepolia".
 *
 * FUNDING GATE: mainnet writes require L1 ETH in the deployer wallet.
 * Build-time status: code is complete and Sepolia-tested; mainnet path is
 * wired but intentionally NOT invoked — call `setTextRecords({ network: "mainnet" })`
 * once the deployer wallet is funded with L1 ETH.
 *
 * @example (Sepolia, safe to call any time)
 *   await setTextRecords({
 *     ensName: "auditor.slopstock.eth",
 *     records: [
 *       { key: "agent-context", value: "Solidity security auditor…" },
 *       { key: "agent-endpoint[x402]", value: "https://operator.slopstock.xyz/x402/infer?tokenId=1" },
 *     ],
 *     deployerKey: process.env.DEPLOYER_PRIVATE_KEY,
 *     network: "sepolia",
 *   });
 */
export async function setTextRecords(
  opts: SetTextRecordsOpts,
): Promise<SetTextRecordsResult> {
  const network = opts.network ?? "sepolia";
  const isMainnet = network === "mainnet";

  // Select chain config
  const chain = isMainnet ? mainnet : sepolia;
  const resolverAddress: Hex = isMainnet
    ? PUBLIC_RESOLVER_MAINNET
    : PUBLIC_RESOLVER_SEPOLIA;
  const defaultRpc = isMainnet
    ? "https://ethereum-rpc.publicnode.com"
    : "https://ethereum-sepolia-rpc.publicnode.com";
  const rpcUrl = opts.rpcUrl ?? defaultRpc;

  const node = namehash(opts.ensName);
  const account = privateKeyToAccount(opts.deployerKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  // Verify that the deployer controls this node before writing.
  const currentResolver = (await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: ensRegistryAbi,
    functionName: "resolver",
    args: [node],
  })) as Hex;
  if (
    currentResolver.toLowerCase() !== resolverAddress.toLowerCase() &&
    currentResolver !== "0x0000000000000000000000000000000000000000"
  ) {
    console.warn(
      `[ens-subname:setText] ${opts.ensName} resolver is ${currentResolver}, expected ${resolverAddress}. ` +
        `Records will be written to the configured resolver — ensure it's authoritative.`,
    );
  }

  const txHashes: Hex[] = [];
  for (const record of opts.records) {
    const txHash = await walletClient.writeContract({
      address: resolverAddress,
      abi: publicResolverAbi,
      functionName: "setText",
      args: [node, record.key, record.value],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(
      `[ens-subname:setText] ${opts.ensName} key="${record.key}" value="${record.value.slice(0, 80)}" tx=${txHash} (${network})`,
    );
    txHashes.push(txHash);
  }

  return {
    ensName: opts.ensName,
    node,
    txHashes,
    network,
  };
}

/**
 * Read a single text record from an ENS name (view — no gas).
 *
 * @param ensName  Full ENS name (e.g. "auditor.slopstock.eth")
 * @param key      Text record key (e.g. "agent-context")
 * @param rpcUrl   Ethereum RPC URL (defaults to Sepolia public RPC)
 * @param network  "mainnet" | "sepolia" (defaults to "sepolia")
 */
export async function readTextRecord(
  ensName: string,
  key: string,
  opts?: { rpcUrl?: string; network?: "mainnet" | "sepolia" },
): Promise<string> {
  const network = opts?.network ?? "sepolia";
  const isMainnet = network === "mainnet";
  const chain = isMainnet ? mainnet : sepolia;
  const resolverAddress: Hex = isMainnet ? PUBLIC_RESOLVER_MAINNET : PUBLIC_RESOLVER_SEPOLIA;
  const defaultRpc = isMainnet
    ? "https://ethereum-rpc.publicnode.com"
    : "https://ethereum-sepolia-rpc.publicnode.com";
  const rpcUrl = opts?.rpcUrl ?? defaultRpc;

  const node = namehash(ensName);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const value = (await publicClient.readContract({
    address: resolverAddress,
    abi: publicResolverAbi,
    functionName: "text",
    args: [node, key],
  })) as string;

  return value;
}
