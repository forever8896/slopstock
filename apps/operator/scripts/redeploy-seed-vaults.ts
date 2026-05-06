/**
 * Redeploy RevenueVault for AUDIT, MEMER, ORCL.
 *
 * Why: the original three vaults were constructed with Circle USDC as
 * `paymentAsset`, but the operator's x402 settlement routes TestnetUSDC
 * (matches the Uniswap V3 pool used for off-ramp). Result: every x402 call
 * dropped TestnetUSDC into a vault that reads its balance via Circle USDC,
 * so `snap()` reverts NoBalance and the deposited TestnetUSDC is stranded.
 * RevenueVault.paymentAsset is immutable — the only fix is a fresh deploy.
 *
 * What this does (per agent):
 *   1. Deploys a new RevenueVault(TestnetUSDC, existingShareToken, tokenId)
 *   2. Prints the new address
 *
 * After: update packages/shared/src/addresses.ts with the new addresses.
 * AgentRegistry on 0G is one-shot (no setter), so the operator must layer a
 * static override on top of its chain lookup — done in a separate change.
 *
 * Stranded TestnetUSDC in the old vaults (AUDIT $16, MEMER $1.5, ORCL $4.6)
 * is sunk cost.
 *
 * Run: bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/redeploy-seed-vaults.ts'
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseGwei } from "viem";
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
if (!config.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY missing");

const account = privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(config.BASE_RPC_URL) });
const pub = createPublicClient({ chain: baseSepolia, transport: http(config.BASE_RPC_URL) });

const vaultArt = await findArtifact("RevenueVault");

const TARGETS = ["AUDIT", "MEMER", "ORCL"] as const;
const results: Array<{ ticker: string; oldVault: string; newVault: `0x${string}`; tx: `0x${string}` }> = [];

console.log("deployer:", account.address);
console.log("paymentAsset (TestnetUSDC):", USDC_BASE_SEPOLIA);
console.log();

for (const ticker of TARGETS) {
  const a = BASE_SEPOLIA_AGENTS[ticker]!;
  console.log(`[${ticker}] deploying new RevenueVault…`);
  console.log(`        shareToken : ${a.shareToken}`);
  console.log(`        tokenId    : ${a.tokenId}`);
  console.log(`        old vault  : ${a.revenueVault} (abandoned)`);

  const tx = await wallet.deployContract({
    abi: vaultArt.abi as never,
    bytecode: vaultArt.bytecode,
    args: [USDC_BASE_SEPOLIA, a.shareToken, a.tokenId],
    ...TX_FEES,
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash: tx });
  const newVault = rcpt.contractAddress;
  if (!newVault) throw new Error(`${ticker} vault deploy: no contract address`);
  console.log(`        new vault  : ${newVault}`);
  console.log(`        tx         : ${tx}`);
  console.log();

  results.push({ ticker, oldVault: a.revenueVault, newVault, tx });
}

console.log("DONE — update packages/shared/src/addresses.ts:");
for (const r of results) {
  console.log(`  ${r.ticker}.revenueVault = "${r.newVault}"`);
}
