/**
 * Permissionless finance-stack deployer.
 *
 * Given a freshly-minted iNFT tokenId on 0G Galileo, deploys the three
 * companion contracts on Base Sepolia:
 *   1. ShareToken    — ERC-20 cap (1M supply minted to creator)
 *   2. RevenueVault  — bound to that ShareToken; receives x402 USDC
 *   3. IPOSale       — primary issuance against ShareToken at fixed price
 *
 * Deployer is the operator's DEPLOYER_PRIVATE_KEY (set in Railway env).
 * The Base ETH for gas comes from the same wallet (memory: 0.07 ETH funded).
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseGwei, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

/**
 * Base Sepolia fee headroom. Base fee is typically ~0.005 gwei but ticks up
 * unpredictably; viem's default `estimateFeesPerGas` returns values right at
 * the edge (`baseFee * 1.2 + tip`), and publicnode rejects with a generic
 * "check your parameters" 400 the moment base fee drifts above the cap.
 *
 * 1 gwei priority + 2 gwei max is ~200x current base fee — still costs
 * <0.005 ETH per deploy at typical gas limits and survives any realistic
 * Sepolia spike.
 */
const TX_FEES = {
  maxPriorityFeePerGas: parseGwei("1"),
  maxFeePerGas: parseGwei("2"),
} as const;

// x402 v2 settles in Circle USDC (EIP-3009) — see packages/shared network.ts.
// Bind vault + IPO to Circle so the vault counts what subscribers actually pay;
// binding to our plain-ERC20 TestnetUSDC stranded payments and made snap()
// revert NoBalance. (The Uniswap pay-with-ETH pool routes TestnetUSDC; that
// path needs its own swap-to-Circle, tracked separately in plan 06.)
const CIRCLE_USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const ZG_AGENT_NFT = "0x96BDA325345b0c8b7946567D30648cf8a422eb59" as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// Bundled artifacts (committed for Railway): apps/operator/artifacts/<Name>.json
const ARTIFACTS_DIR = join(SCRIPT_DIR, "..", "..", "artifacts");
const REPO_OUT_GUESSES = [
  join(SCRIPT_DIR, "..", "..", "..", "..", "contracts", "out"), // local dev path
  join("/app", "contracts", "out"),
];

async function findArtifact(name: string): Promise<{ abi: unknown; bytecode: `0x${string}` }> {
  // 1. Bundled artifact (preferred — committed to repo).
  const bundled = join(ARTIFACTS_DIR, `${name}.json`);
  if (existsSync(bundled)) {
    const raw = await readFile(bundled, "utf-8");
    const json = JSON.parse(raw) as { abi: unknown; bytecode: { object: `0x${string}` } };
    return { abi: json.abi, bytecode: json.bytecode.object };
  }
  // 2. Foundry build output (local dev).
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

export interface DeployFinanceInput {
  tokenId: string;
  ticker: string;
  pricePerShareUsd: string; // e.g. "1.00"
  maxShares?: string; // default 100,000
  creator: `0x${string}`; // initial recipient of 1M shares; also IPO beneficiary
  deployerKey: `0x${string}`;
  rpcUrl: string;
}

export interface DeployFinanceResult {
  shareToken: `0x${string}`;
  revenueVault: `0x${string}`;
  ipoSale: `0x${string}`;
  txHashes: { shareToken: `0x${string}`; revenueVault: `0x${string}`; ipoSale: `0x${string}` };
  beneficiary: `0x${string}`;
}

export async function deployFinanceStack(input: DeployFinanceInput): Promise<DeployFinanceResult> {
  const account = privateKeyToAccount(input.deployerKey);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(input.rpcUrl) });
  const pub = createPublicClient({ chain: baseSepolia, transport: http(input.rpcUrl) });

  const tokenId = BigInt(input.tokenId);
  const maxSharesStr = input.maxShares ?? "100000";
  const maxShares = parseUnits(maxSharesStr, 18);
  const pricePerShareSmallest = parseUnits(input.pricePerShareUsd, 6);
  const startsAt = BigInt(Math.floor(Date.now() / 1000));
  const endsAt = startsAt + 7n * 24n * 3600n; // 7-day IPO window

  console.log(
    `[finance-deploy] starting for tokenId=${input.tokenId} ticker=${input.ticker} price=$${input.pricePerShareUsd} maxShares=${maxSharesStr}`,
  );

  // 1. ShareToken
  const stArt = await findArtifact("ShareToken");
  const stHash = await wallet.deployContract({
    abi: stArt.abi as never,
    bytecode: stArt.bytecode,
    args: [
      ZG_AGENT_NFT,
      tokenId,
      `${input.ticker} Shares`,
      input.ticker,
      input.creator,
    ],
    ...TX_FEES,
  });
  console.log(`[finance-deploy] ShareToken tx=${stHash}`);
  const stReceipt = await pub.waitForTransactionReceipt({ hash: stHash });
  const shareToken = stReceipt.contractAddress as `0x${string}`;
  if (!shareToken) throw new Error("ShareToken deploy: no contract address in receipt");

  // 2. RevenueVault
  const vaultArt = await findArtifact("RevenueVault");
  const vaultHash = await wallet.deployContract({
    abi: vaultArt.abi as never,
    bytecode: vaultArt.bytecode,
    args: [CIRCLE_USDC_BASE_SEPOLIA, shareToken, tokenId],
    ...TX_FEES,
  });
  console.log(`[finance-deploy] RevenueVault tx=${vaultHash}`);
  const vaultReceipt = await pub.waitForTransactionReceipt({ hash: vaultHash });
  const revenueVault = vaultReceipt.contractAddress as `0x${string}`;
  if (!revenueVault) throw new Error("RevenueVault deploy: no contract address in receipt");

  // 3. IPOSale
  const ipoArt = await findArtifact("IPOSale");
  const ipoHash = await wallet.deployContract({
    abi: ipoArt.abi as never,
    bytecode: ipoArt.bytecode,
    args: [
      shareToken,
      CIRCLE_USDC_BASE_SEPOLIA,
      pricePerShareSmallest,
      maxShares,
      input.creator,
      startsAt,
      endsAt,
    ],
    ...TX_FEES,
  });
  console.log(`[finance-deploy] IPOSale tx=${ipoHash}`);
  const ipoReceipt = await pub.waitForTransactionReceipt({ hash: ipoHash });
  const ipoSale = ipoReceipt.contractAddress as `0x${string}`;
  if (!ipoSale) throw new Error("IPOSale deploy: no contract address in receipt");

  console.log(
    `[finance-deploy] complete tokenId=${input.tokenId} share=${shareToken} vault=${revenueVault} ipo=${ipoSale}`,
  );

  return {
    shareToken,
    revenueVault,
    ipoSale,
    txHashes: { shareToken: stHash, revenueVault: vaultHash, ipoSale: ipoHash },
    beneficiary: input.creator,
  };
}
