/**
 * ERC-8004 registration + ENSIP-25 verification record for an agent.
 *
 *   1. register(agentURI) on the Base mainnet IdentityRegistry -> agentId (simulate first)
 *   2. write agent-registration[<interop(8453,registry)>][<agentId>]="1" on the agent's
 *      mainnet ENS name (ENSIP-25 attestation: name owner attests back to the registry)
 *   3. verifyAgent() — proves ENSIP-25 passes; and a negative check (bogus id) fails
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/erc8004-register.ts <ensName> [agentURI]'
 */

import { createPublicClient, createWalletClient, http, parseEventLogs, getAddress, type Hex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { encodeInteropAddress, ensip25RegistrationKey, CHAIN_TYPE_EIP155 } from "@stratum/shared";
import { setTextRecords } from "../src/store/ens-subname.ts";
import { verifyAgent } from "../src/store/ens-agent-resolver.ts";

const REGISTRY = getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"); // Base mainnet IdentityRegistry
const BASE_CHAIN = 8453;
const BASE_RPC = "https://mainnet.base.org";
const L1_RPC = process.env["L1_RPC"] ?? "https://ethereum-rpc.publicnode.com";

const ensName = process.argv[2] ?? "auditor.slopstock.eth";
const agentURI = process.argv[3] ?? "https://stratum.app/agent/auditor/card.json";

const registryAbi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "event", name: "Registered", inputs: [{ name: "agentId", type: "uint256", indexed: true }, { name: "agentURI", type: "string", indexed: false }, { name: "owner", type: "address", indexed: true }] },
] as const;

const key = process.env["DEPLOYER_PRIVATE_KEY"] as Hex;
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: base, transport: http(BASE_RPC) });
const wallet = createWalletClient({ account, chain: base, transport: http(BASE_RPC) });

console.log(`ERC-8004 register · ${ensName} · deployer ${account.address}`);
console.log(`registry ${REGISTRY} (Base mainnet) · agentURI ${agentURI}\n`);

// 1. register (simulate first to surface ABI/selector issues before spending)
let agentId: bigint;
try {
  const sim = await pub.simulateContract({ address: REGISTRY, abi: registryAbi, functionName: "register", args: [agentURI], account });
  console.log(`[1] simulate ok → agentId ${sim.result}`);
  // Sign locally (don't pass sim.request — its account is a bare address, which
  // makes viem fall back to node eth_sendTransaction). The walletClient holds
  // the local PrivateKeyAccount, so an explicit call signs + eth_sendRawTransaction.
  const tx = await wallet.writeContract({ address: REGISTRY, abi: registryAbi, functionName: "register", args: [agentURI], account, chain: base });
  const rcpt = await pub.waitForTransactionReceipt({ hash: tx });
  const ev = parseEventLogs({ abi: registryAbi, logs: rcpt.logs, eventName: "Registered" })[0];
  agentId = ev ? (ev.args as { agentId: bigint }).agentId : (sim.result as bigint);
  console.log(`    registered agentId=${agentId} tx=${tx} (status ${rcpt.status})`);
} catch (e) {
  console.error(`[1] register failed: ${(e as Error).message.split("\n").slice(0, 3).join(" | ")}`);
  process.exit(1);
}

// 2. ENSIP-25 record on the ENS name
const interop = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_CHAIN, REGISTRY);
const ensip25Key = ensip25RegistrationKey(BASE_CHAIN, REGISTRY, String(agentId));
console.log(`\n[2] writing ENSIP-25 record on ${ensName}`);
console.log(`    interop(8453,registry) = ${interop}`);
console.log(`    key = ${ensip25Key}`);
await setTextRecords({ ensName, network: "mainnet", rpcUrl: L1_RPC, deployerKey: key, records: [{ key: ensip25Key, value: "1" }] });

// 3. verify (positive + negative)
console.log(`\n[3] ENSIP-25 verification`);
const good = await verifyAgent(ensName, interop, String(agentId), { network: "mainnet", rpcUrl: L1_RPC });
console.log(`    real agentId ${agentId}: verified=${good.verified} value="${good.recordValue}"`);
const bad = await verifyAgent(ensName, interop, "999999", { network: "mainnet", rpcUrl: L1_RPC });
console.log(`    bogus agentId 999999: verified=${bad.verified} (${bad.reason ?? "ok"})`);

console.log(`\n${good.verified && !bad.verified ? "✅" : "❌"} ERC-8004 + ENSIP-25 live on mainnet — agent #${agentId} verifiable, forgery rejected`);
