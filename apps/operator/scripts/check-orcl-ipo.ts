/**
 * Diagnose why ORCL's IPOSale is/isn't buyable.
 *
 * Reads on-chain state for: pricePerShare, maxShares, sold, beneficiary,
 * startsAt, endsAt, isOpen — plus the beneficiary's ShareToken balance and
 * the allowance the beneficiary granted to the IPOSale. The two most common
 * failure modes are (a) beneficiary never approved IPOSale to pull shares,
 * (b) beneficiary doesn't actually hold the 1M ShareToken supply.
 *
 * Run: bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/check-orcl-ipo.ts'
 */

import { createPublicClient, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_SEPOLIA_AGENTS, USDC_BASE_SEPOLIA } from "@stratum/shared";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
const orcl = BASE_SEPOLIA_AGENTS["ORCL"]!;
const pub = createPublicClient({ chain: baseSepolia, transport: http(config.BASE_RPC_URL) });

const ipoAbi = [
  { type: "function", name: "pricePerShare", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "beneficiary", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "startsAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "endsAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "isOpen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "paymentAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "shareToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

console.log("ORCL agent");
console.log("  tokenId       :", orcl.tokenId);
console.log("  shareToken    :", orcl.shareToken);
console.log("  revenueVault  :", orcl.revenueVault);
console.log("  ipoSale       :", orcl.ipoSale);
console.log();

const [
  pricePerShare,
  maxShares,
  sold,
  beneficiary,
  startsAt,
  endsAt,
  isOpen,
  paymentAsset,
  shareToken,
  totalSupply,
] = await Promise.all([
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "pricePerShare" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "maxShares" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "sold" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "beneficiary" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "startsAt" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "endsAt" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "isOpen" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "paymentAsset" }),
  pub.readContract({ address: orcl.ipoSale, abi: ipoAbi, functionName: "shareToken" }),
  pub.readContract({ address: orcl.shareToken, abi: erc20Abi, functionName: "totalSupply" }),
]);

const [benShareBal, benAllowance] = await Promise.all([
  pub.readContract({ address: orcl.shareToken, abi: erc20Abi, functionName: "balanceOf", args: [beneficiary] }),
  pub.readContract({ address: orcl.shareToken, abi: erc20Abi, functionName: "allowance", args: [beneficiary, orcl.ipoSale] }),
]);

const now = Math.floor(Date.now() / 1000);
const tdx = (s: bigint | number) => new Date(Number(s) * 1000).toISOString();

console.log("IPOSale config");
console.log("  pricePerShare :", pricePerShare.toString(), `(= $${formatUnits(pricePerShare, 6)} USDC)`);
console.log("  maxShares     :", formatUnits(maxShares, 18));
console.log("  sold          :", formatUnits(sold, 18));
console.log("  available     :", formatUnits(maxShares - sold, 18));
console.log("  beneficiary   :", beneficiary);
console.log("  paymentAsset  :", paymentAsset, paymentAsset.toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase() ? "(✓ TestnetUSDC)" : "(⚠ NOT TestnetUSDC)");
console.log("  shareToken    :", shareToken, shareToken.toLowerCase() === orcl.shareToken.toLowerCase() ? "(✓)" : "(⚠ MISMATCH)");
console.log("  startsAt      :", startsAt.toString(), tdx(startsAt));
console.log("  endsAt        :", endsAt.toString(), tdx(endsAt));
console.log("  now           :", now, new Date(now * 1000).toISOString());
console.log("  isOpen()      :", isOpen, isOpen ? "✓" : "⚠ closed");
console.log();

console.log("ShareToken state");
console.log("  totalSupply           :", formatUnits(totalSupply, 18));
console.log("  beneficiary balance   :", formatUnits(benShareBal as bigint, 18));
console.log("  allowance(ben → IPO)  :", formatUnits(benAllowance as bigint, 18));
console.log();

console.log("Deployer (env)         :", privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY as `0x${string}`).address);
console.log();

const reasons: string[] = [];
if (!isOpen) {
  if (now < Number(startsAt)) reasons.push(`window not open yet (starts ${tdx(startsAt)})`);
  else if (now >= Number(endsAt)) reasons.push(`window expired (ended ${tdx(endsAt)})`);
}
if ((benShareBal as bigint) < (maxShares - sold)) {
  reasons.push(`beneficiary holds ${formatUnits(benShareBal as bigint, 18)} shares but IPO has ${formatUnits(maxShares - sold, 18)} available — missing supply`);
}
if ((benAllowance as bigint) < (maxShares - sold)) {
  reasons.push(`beneficiary's allowance to IPOSale is ${formatUnits(benAllowance as bigint, 18)} — needs ≥ ${formatUnits(maxShares - sold, 18)} for buys to pull shares`);
}

if (reasons.length === 0) {
  console.log("✓ IPOSale looks fully functional. Buys should work.");
} else {
  console.log("Issues found:");
  for (const r of reasons) console.log("  ⚠", r);
}
