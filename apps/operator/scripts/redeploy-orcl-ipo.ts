/**
 * Redeploy ORCL's IPOSale.
 *
 * The ORCL IPOSale that shipped with the seed agents had two demo-blocking
 * issues by 2026-05-06:
 *   1. payment asset was Circle USDC (the operator's x402 + the Uniswap pool
 *      both speak TestnetUSDC), so even successful buys would route the wrong
 *      asset into the beneficiary's wallet.
 *   2. the 7-day window had expired.
 *
 * Fix: deploy a fresh IPOSale binding the existing ShareToken to TestnetUSDC
 * with a 30-day window, then deployer.approve(newIPO, maxShares) so buys can
 * pull shares from the beneficiary. ShareToken + RevenueVault are reused —
 * the cap table doesn't need rebuilding.
 *
 * After: update packages/shared/src/addresses.ts ORCL.ipoSale to the new
 * address printed below.
 *
 * Run: bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/redeploy-orcl-ipo.ts'
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseGwei,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_AGENTS, USDC_BASE_SEPOLIA } from "@stratum/shared";
import { loadConfig } from "../src/config.ts";

const TX_FEES = {
  maxPriorityFeePerGas: parseGwei("1"),
  maxFeePerGas: parseGwei("2"),
} as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(SCRIPT_DIR, "..", "artifacts");
const REPO_OUT_GUESSES = [
  join(SCRIPT_DIR, "..", "..", "..", "contracts", "out"),
  join("/app", "contracts", "out"),
];

async function findArtifact(name: string): Promise<{ abi: unknown; bytecode: `0x${string}` }> {
  const bundled = join(ARTIFACTS_DIR, `${name}.json`);
  if (existsSync(bundled)) {
    const raw = await readFile(bundled, "utf-8");
    const json = JSON.parse(raw) as { abi: unknown; bytecode: { object: `0x${string}` } };
    return { abi: json.abi, bytecode: json.bytecode.object };
  }
  for (const root of REPO_OUT_GUESSES) {
    const p = join(root, `${name}.sol`, `${name}.json`);
    if (existsSync(p)) {
      const raw = await readFile(p, "utf-8");
      const json = JSON.parse(raw) as { abi: unknown; bytecode: { object: `0x${string}` } };
      return { abi: json.abi, bytecode: json.bytecode.object };
    }
  }
  throw new Error(`artifact not found: ${name}.json`);
}

const config = loadConfig();
if (!config.DEPLOYER_PRIVATE_KEY) {
  throw new Error("DEPLOYER_PRIVATE_KEY missing — required to deploy + approve");
}

const orcl = BASE_SEPOLIA_AGENTS["ORCL"]!;
const account = privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(config.BASE_RPC_URL) });
const pub = createPublicClient({ chain: baseSepolia, transport: http(config.BASE_RPC_URL) });

console.log("ORCL IPOSale redeploy");
console.log("  shareToken    :", orcl.shareToken);
console.log("  revenueVault  :", orcl.revenueVault, "(unchanged)");
console.log("  oldIpoSale    :", orcl.ipoSale, "(will be abandoned)");
console.log("  beneficiary   :", account.address);
console.log("  paymentAsset  :", USDC_BASE_SEPOLIA, "(TestnetUSDC)");
console.log();

// $0.20 per share — same price the old contract used.
const pricePerShareUsd = "0.20";
const pricePerShareSmallest = parseUnits(pricePerShareUsd, 6);
const maxSharesStr = "100000";
const maxShares = parseUnits(maxSharesStr, 18);
const startsAt = BigInt(Math.floor(Date.now() / 1000) - 60); // -60s for clock skew tolerance
const endsAt = startsAt + 30n * 24n * 3600n; // 30-day window

console.log(`config: price=$${pricePerShareUsd} maxShares=${maxSharesStr} window=30d`);
console.log();

const ipoArt = await findArtifact("IPOSale");
console.log("[1/3] deploying IPOSale…");
const ipoHash = await wallet.deployContract({
  abi: ipoArt.abi as never,
  bytecode: ipoArt.bytecode,
  args: [
    orcl.shareToken,
    USDC_BASE_SEPOLIA,
    pricePerShareSmallest,
    maxShares,
    account.address,
    startsAt,
    endsAt,
  ],
  ...TX_FEES,
});
console.log("       tx       :", ipoHash);
const ipoReceipt = await pub.waitForTransactionReceipt({ hash: ipoHash });
const newIpoSale = ipoReceipt.contractAddress;
if (!newIpoSale) throw new Error("IPOSale deploy: no contract address in receipt");
console.log("       address  :", newIpoSale);
console.log();

console.log("[2/3] approving new IPOSale to pull shares from deployer…");
const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
const approveHash = await wallet.writeContract({
  address: orcl.shareToken,
  abi: erc20ApproveAbi,
  functionName: "approve",
  args: [newIpoSale, maxShares],
  ...TX_FEES,
});
console.log("       tx       :", approveHash);
await pub.waitForTransactionReceipt({ hash: approveHash });
console.log("       approved :", formatUnits(maxShares, 18), "shares");
console.log();

console.log("[3/3] verifying state on new IPOSale…");
const ipoAbi = [
  { type: "function", name: "isOpen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "available", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "beneficiary", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paymentAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const [isOpen, available, beneficiary, paymentAsset, allowance] = await Promise.all([
  pub.readContract({ address: newIpoSale, abi: ipoAbi, functionName: "isOpen" }),
  pub.readContract({ address: newIpoSale, abi: ipoAbi, functionName: "available" }),
  pub.readContract({ address: newIpoSale, abi: ipoAbi, functionName: "beneficiary" }),
  pub.readContract({ address: newIpoSale, abi: ipoAbi, functionName: "paymentAsset" }),
  pub.readContract({ address: orcl.shareToken, abi: erc20Abi, functionName: "allowance", args: [account.address, newIpoSale] }),
]);
console.log("       isOpen        :", isOpen);
console.log("       available     :", formatUnits(available as bigint, 18), "shares");
console.log("       beneficiary   :", beneficiary);
console.log("       paymentAsset  :", paymentAsset, paymentAsset.toString().toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase() ? "✓" : "⚠");
console.log("       allowance     :", formatUnits(allowance as bigint, 18), "shares");
console.log();

console.log("DONE. update packages/shared/src/addresses.ts:");
console.log(`  ORCL.ipoSale = "${newIpoSale}"`);
