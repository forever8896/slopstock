/**
 * Publish an agent's ENSIP-26 records on a slopstock.eth subname on ETH MAINNET.
 *
 *   1. ensure <label>.slopstock.eth exists on mainnet (setSubnodeRecord, resolver = PublicResolver)
 *   2. write agent-context + agent-endpoint[x402|web] (setTextRecords) + addr -> vault
 *   3. read everything back via resolveAgent (proves any ENS client can see it)
 *
 * Real L1 mainnet writes. Deployer owns slopstock.eth on mainnet. Gas ~0.12 gwei
 * => a handful of writes costs well under $0.01.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/ens-mainnet-publish.ts <label>'
 */

import { createPublicClient, createWalletClient, http, namehash, keccak256, toBytes, getAddress, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { setTextRecords } from "../src/store/ens-subname.ts";
import { resolveAgent } from "../src/store/ens-agent-resolver.ts";

const L1_RPC = process.env["L1_RPC"] ?? "https://ethereum-rpc.publicnode.com";
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as Hex;
const PUBLIC_RESOLVER_MAINNET = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41" as Hex;
const SLOPSTOCK_NODE = namehash("slopstock.eth");
const AUDIT_VAULT = "0x67826ded1ff988eb2711b5ad6bd2752a311893b9" as Hex; // addr-record target

const label = (process.argv[2] ?? "auditor").toLowerCase();
const ensName = `${label}.slopstock.eth`;
const labelHash = keccak256(toBytes(label));
const node = namehash(ensName);

const registryAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "setSubnodeRecord", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint64" }], outputs: [] },
] as const;
const resolverAbi = [
  { type: "function", name: "setAddr", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
] as const;

const key = process.env["DEPLOYER_PRIVATE_KEY"] as Hex;
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: mainnet, transport: http(L1_RPC) });
const wallet = createWalletClient({ account, chain: mainnet, transport: http(L1_RPC) });

console.log(`publishing ${ensName} on ETH mainnet · deployer ${account.address}\n`);

// 1. ensure subname exists, owned by deployer, resolver = PublicResolver
const owner = getAddress(await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "owner", args: [node] }));
const ZERO = "0x0000000000000000000000000000000000000000";
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.log(`[1] creating subname (current owner ${owner})…`);
  const tx = await wallet.writeContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "setSubnodeRecord", args: [SLOPSTOCK_NODE, labelHash, account.address, PUBLIC_RESOLVER_MAINNET, 0n] });
  await pub.waitForTransactionReceipt({ hash: tx });
  console.log(`    created ${ensName} owner=${account.address} resolver=${PUBLIC_RESOLVER_MAINNET} tx=${tx}`);
} else {
  console.log(`[1] ${ensName} already owned by deployer ✓`);
}

// 2. ENSIP-26 text records
console.log(`[2] writing ENSIP-26 text records…`);
await setTextRecords({
  ensName,
  network: "mainnet",
  rpcUrl: L1_RPC,
  deployerKey: key,
  records: [
    { key: "agent-context", value: "AUDIT — autonomous Solidity security auditor. Sealed TEE inference on 0G mainnet (deepseek-v4), x402 paywall, ERC-7857 iNFT with on-chain revenue split to shareholders. Part of Slopstock — a stock exchange for AI agents." },
    { key: "agent-endpoint[x402]", value: "https://gateway.stratum.app/x402/infer?agent=auditor" },
    { key: "agent-endpoint[web]", value: "https://stratum.app/agent/auditor" },
  ],
});
// addr -> vault
const addrTx = await wallet.writeContract({ address: PUBLIC_RESOLVER_MAINNET, abi: resolverAbi, functionName: "setAddr", args: [node, AUDIT_VAULT] });
await pub.waitForTransactionReceipt({ hash: addrTx });
console.log(`    addr → ${AUDIT_VAULT} tx=${addrTx}`);

// 3. read back via resolveAgent (what any ENS client sees)
console.log(`\n[3] reading back via resolveAgent (mainnet)…`);
const r = await resolveAgent(ensName, { network: "mainnet", rpcUrl: L1_RPC });
console.log(JSON.stringify(r, null, 2));
const ok = !!r.agentContext && !!r.endpointX402;
console.log(`\n${ok ? "✅" : "❌"} ${ensName} is live on mainnet ENS — resolvable by any client`);
