/**
 * Pre-demo balance audit: walks every wallet that has to pay for an
 * operation during the demo and flags any that's running low.
 *
 * Wallets covered:
 *   - deployer        (Base Sepolia ETH — for any contract redeploys / approves)
 *   - operator        (0G ETH for grants, Base ETH for x402 receipt writes,
 *                      0G compute ledger prepayment)
 *   - agent wallets   (per-tokenId; need Base ETH + TestnetUSDC to call other
 *                      agents' x402 endpoints — e.g. AUDIT pays ORCL)
 *   - agent vaults    (TestnetUSDC currently sitting, awaiting distribution)
 *
 * Run:  bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/check-demo-balances.ts'
 */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { createPublicClient, http, formatUnits, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { BASE_SEPOLIA_AGENTS, USDC_BASE_SEPOLIA } from "@stratum/shared";
import { loadConfig } from "../src/config.ts";
import { agentWalletFor } from "../src/runtime/agent-wallet.ts";

const config = loadConfig();
const base = createPublicClient({ chain: baseSepolia, transport: http(config.BASE_RPC_URL) });
const zgEthersProvider = new ethers.JsonRpcProvider(config.ZG_COMPUTE_RPC_URL);

const erc20BalanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// Thresholds — flag anything beneath these as `LOW`.
const MIN_BASE_ETH = 0.005; // ~5 mainnet-equivalent gwei × 1M gas
const MIN_OP_BASE_ETH = 0.02; // operator does multiple x402 settlements per call
const MIN_DEPLOYER_BASE_ETH = 0.01;
const MIN_AGENT_USDC = 1.0; // one cross-agent x402 call costs $0.10–0.50
const MIN_OPERATOR_0G_ETH = 0.1; // for authorizeUsage grants
const MIN_LEDGER_BALANCE_0G = 0.05; // operator prepays TEE inference

interface Row {
  label: string;
  detail: string;
  balanceHuman: string;
  ok: boolean;
  note?: string;
}
const rows: Row[] = [];

function flag(ok: boolean): string {
  return ok ? "✓" : "⚠ LOW";
}

async function baseEth(addr: `0x${string}`): Promise<bigint> {
  return base.getBalance({ address: addr });
}
async function baseUsdc(addr: `0x${string}`): Promise<bigint> {
  return base.readContract({ address: USDC_BASE_SEPOLIA, abi: erc20BalanceAbi, functionName: "balanceOf", args: [addr] }) as Promise<bigint>;
}

// 1. Deployer
const deployer = config.DEPLOYER_PRIVATE_KEY
  ? privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY as `0x${string}`).address
  : null;
if (deployer) {
  const eth = await baseEth(deployer);
  const ethN = Number(formatEther(eth));
  rows.push({
    label: "deployer",
    detail: `${deployer} · Base ETH`,
    balanceHuman: `${ethN.toFixed(5)} ETH`,
    ok: ethN >= MIN_DEPLOYER_BASE_ETH,
    note: ethN < MIN_DEPLOYER_BASE_ETH ? `min ${MIN_DEPLOYER_BASE_ETH} ETH` : undefined,
  });
}

// 2. Operator
const operator = privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as `0x${string}`).address;
{
  const ethBase = await baseEth(operator);
  const ethBaseN = Number(formatEther(ethBase));
  rows.push({
    label: "operator",
    detail: `${operator} · Base ETH (x402 receipt writes)`,
    balanceHuman: `${ethBaseN.toFixed(5)} ETH`,
    ok: ethBaseN >= MIN_OP_BASE_ETH,
    note: ethBaseN < MIN_OP_BASE_ETH ? `min ${MIN_OP_BASE_ETH} ETH for repeat calls` : undefined,
  });

  const eth0g = await zgEthersProvider.getBalance(operator);
  const eth0gN = Number(ethers.formatEther(eth0g));
  rows.push({
    label: "operator",
    detail: `${operator} · 0G ETH (authorizeUsage grants)`,
    balanceHuman: `${eth0gN.toFixed(5)} 0G`,
    ok: eth0gN >= MIN_OPERATOR_0G_ETH,
    note: eth0gN < MIN_OPERATOR_0G_ETH ? `min ${MIN_OPERATOR_0G_ETH} 0G` : undefined,
  });
}

// 3. 0G Compute ledger
try {
  const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, zgEthersProvider);
  const broker = await createZGComputeNetworkBroker(wallet);
  const ledger = await broker.ledger.getLedger();
  const totalBalance = ledger.totalBalance ?? ledger.balance ?? 0n;
  const human = Number(ethers.formatEther(totalBalance));
  rows.push({
    label: "0G compute",
    detail: `ledger total balance (TEE inference prepay)`,
    balanceHuman: `${human.toFixed(5)} 0G`,
    ok: human >= MIN_LEDGER_BALANCE_0G,
    note: human < MIN_LEDGER_BALANCE_0G ? `top up via setup-0g-mainnet.ts` : undefined,
  });
  // Per-provider account
  try {
    const account = await broker.inference.getAccount(config.ZG_COMPUTE_PROVIDER_ADDRESS as `0x${string}`);
    const bal = (account.balance ?? 0n) as bigint;
    const balH = Number(ethers.formatEther(bal));
    rows.push({
      label: "0G provider",
      detail: `account at ${config.ZG_COMPUTE_PROVIDER_ADDRESS}`,
      balanceHuman: `${balH.toFixed(5)} 0G`,
      ok: balH > 0,
    });
  } catch (err) {
    rows.push({
      label: "0G provider",
      detail: `account at ${config.ZG_COMPUTE_PROVIDER_ADDRESS}`,
      balanceHuman: "—",
      ok: false,
      note: `getAccount error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
    });
  }
} catch (err) {
  rows.push({
    label: "0G compute",
    detail: "ledger",
    balanceHuman: "—",
    ok: false,
    note: `broker err: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
  });
}

// 4. Per-agent wallets (tokenIds 1, 2, 3)
for (const ticker of ["AUDIT", "MEMER", "ORCL"] as const) {
  const meta = BASE_SEPOLIA_AGENTS[ticker]!;
  const wallet = agentWalletFor(config.OPERATOR_PRIVATE_KEY as `0x${string}`, meta.tokenId);
  const [eth, usdc] = await Promise.all([baseEth(wallet.address), baseUsdc(wallet.address)]);
  const ethN = Number(formatEther(eth));
  const usdcN = Number(formatUnits(usdc, 6));
  rows.push({
    label: `agent ${ticker}`,
    detail: `${wallet.address} · Base ETH`,
    balanceHuman: `${ethN.toFixed(5)} ETH`,
    ok: ethN >= MIN_BASE_ETH,
    note: ethN < MIN_BASE_ETH ? `min ${MIN_BASE_ETH} ETH (gas for cross-agent x402)` : undefined,
  });
  rows.push({
    label: `agent ${ticker}`,
    detail: `${wallet.address} · TestnetUSDC`,
    balanceHuman: `$${usdcN.toFixed(2)}`,
    ok: usdcN >= MIN_AGENT_USDC,
    note: usdcN < MIN_AGENT_USDC ? `mint via mint-testnet-usdc.ts (caller agents pay $0.10/call)` : undefined,
  });
}

// 5. Vault TestnetUSDC balances (informational)
for (const ticker of ["AUDIT", "MEMER", "ORCL"] as const) {
  const meta = BASE_SEPOLIA_AGENTS[ticker]!;
  const usdc = await baseUsdc(meta.revenueVault as `0x${string}`);
  const usdcN = Number(formatUnits(usdc, 6));
  rows.push({
    label: `${ticker} vault`,
    detail: `${meta.revenueVault} · pending revenue`,
    balanceHuman: `$${usdcN.toFixed(4)}`,
    ok: true, // informational
  });
}

// Render
const longest = Math.max(...rows.map((r) => r.label.length));
console.log("\n┌─ pre-demo balance audit ─────────────────────────────────────────────────────────────");
for (const r of rows) {
  console.log(
    `│ ${flag(r.ok).padEnd(6)} ${r.label.padEnd(longest)}  ${r.balanceHuman.padStart(16)}  ${r.detail}`,
  );
  if (r.note) console.log(`│        ${" ".repeat(longest)}                   ↳ ${r.note}`);
}
console.log("└──────────────────────────────────────────────────────────────────────────────────────\n");

const issues = rows.filter((r) => !r.ok);
if (issues.length === 0) {
  console.log("✓ all wallets funded for demo");
} else {
  console.log(`⚠ ${issues.length} wallet(s) under threshold — top up before demo:`);
  for (const r of issues) console.log(`  • ${r.label}: ${r.detail}${r.note ? "  (" + r.note + ")" : ""}`);
  process.exit(1);
}
