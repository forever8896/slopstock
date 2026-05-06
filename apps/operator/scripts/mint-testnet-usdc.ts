/**
 * One-shot: mint TestnetUSDC to a recipient using DEPLOYER_PRIVATE_KEY.
 * Usage: bun run apps/operator/scripts/mint-testnet-usdc.ts <recipient> <amountUsd>
 */

import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { USDC_BASE_SEPOLIA } from "@stratum/shared";

const recipient = process.argv[2] as `0x${string}`;
const amountUsd = process.argv[3] ?? "50";
if (!recipient || !recipient.startsWith("0x")) {
  console.error("usage: mint-testnet-usdc.ts <0xRecipient> [amountUsd=50]");
  process.exit(1);
}

const key = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY missing");

const rpc = process.env.BASE_RPC_URL ?? "https://base-sepolia-rpc.publicnode.com";
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });

const mintAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const amount = parseUnits(amountUsd, 6);

console.log(`minting ${amountUsd} TestnetUSDC -> ${recipient}`);
const hash = await wallet.writeContract({
  address: USDC_BASE_SEPOLIA,
  abi: mintAbi,
  functionName: "mint",
  args: [recipient, amount],
  gas: 150_000n,
});
console.log(`tx: ${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`confirmed in block ${receipt.blockNumber} status=${receipt.status}`);

const bal = await pub.readContract({
  address: USDC_BASE_SEPOLIA,
  abi: mintAbi,
  functionName: "balanceOf",
  args: [recipient],
});
console.log(`new balance: ${(Number(bal) / 1e6).toFixed(2)} TestnetUSDC`);
console.log(`https://sepolia.basescan.org/tx/${hash}`);
