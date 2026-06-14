/**
 * Live on-chain pieces of the self-funding loop. These are the only parts that
 * move real money; everything that decides *whether* to move it lives in the
 * pure, tested policy/orchestrator. The executor is invoked by the cron ONLY
 * when dry-run is off, so a bug here can never fire until explicitly enabled.
 *
 * Top-up path (verified viable in design notes):
 *   USDC → ETH   — direct Uniswap V3 swap on Base (LI.FI's aggregator refuses
 *                  small USDC→ETH legs; a direct pool swap has no such floor).
 *   ETH  → OG    — LI.FI quote (gasZip route; verified to quote for small ETH).
 *   OG   → ledger — broker.ledger.depositFund (units are whole OG).
 *
 * Reads:
 *   readLedgerOg     — current 0G compute-ledger balance (the low-fuel signal).
 *   readUsdcBalance  — operator's accrued compute reserve (the split slice).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
  formatUnits,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import type { ZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import type { TopupExecutor } from "./topup.ts";

// ── Base mainnet addresses ──────────────────────────────────────────────────
export const BASE_USDC: Hex = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_WETH: Hex = "0x4200000000000000000000000000000000000006";
/** Uniswap V3 SwapRouter02 on Base mainnet. */
export const BASE_SWAP_ROUTER: Hex = "0x2626664c2603336E57B271c5C0b26F421741e481";
/** USDC/WETH 0.05% pool is the deepest small-trade tier on Base. */
export const USDC_WETH_FEE = 500;

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[])",
]);

/** Read the operator's USDC balance on Base (the accrued compute reserve). */
export async function readUsdcBalance(client: PublicClient, owner: Hex): Promise<bigint> {
  return client.readContract({ address: BASE_USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

/**
 * Read the 0G compute-ledger balance (OG smallest units). Uses the broker's
 * ledger detail; `ledgerInfo[0]` is the total ledger balance. Falls back to 0n
 * if the ledger doesn't exist yet (then the watcher will want a top-up).
 */
export async function readLedgerOg(broker: ZGComputeNetworkBroker): Promise<bigint> {
  try {
    const ledger = await broker.ledger.getLedger();
    // LedgerStructOutput is an ethers named tuple; availableBalance is the
    // spendable compute balance (OG, 18dp) — the low-fuel signal we watch.
    const bal = (ledger as unknown as { availableBalance?: bigint }).availableBalance;
    return typeof bal === "bigint" ? bal : 0n;
  } catch {
    return 0n; // no ledger yet → treat as empty (watcher will want a top-up)
  }
}

export interface ExecutorDeps {
  baseRpcUrl: string;
  account: Account;
  broker: ZGComputeNetworkBroker;
  /** Slippage tolerance in bps for the USDC→ETH swap (e.g. 100 = 1%). */
  slippageBps: number;
  /** LI.FI quote endpoint (override for tests). */
  lifiQuoteUrl?: string;
}

/**
 * Real USDC→ETH→OG→ledger executor. Constructed only on the live path.
 */
export class LiveTopupExecutor implements TopupExecutor {
  private readonly base: PublicClient;
  private readonly wallet: WalletClient;

  constructor(private readonly deps: ExecutorDeps) {
    this.base = createPublicClient({ transport: http(deps.baseRpcUrl) }) as PublicClient;
    this.wallet = createWalletClient({ account: deps.account, transport: http(deps.baseRpcUrl) });
  }

  async execute(amountUsdc: bigint): Promise<{ ok: boolean; detail: string }> {
    try {
      const ethOut = await this.swapUsdcToEth(amountUsdc);
      const ogDelta = await this.bridgeEthToOg(ethOut);
      await this.depositToLedger(ogDelta);
      return { ok: true, detail: `swapped $${formatUnits(amountUsdc, 6)} → ${formatEther(ethOut)} ETH → +${formatEther(ogDelta)} OG to ledger` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  /** Approve (if needed) + Uniswap V3 exactInputSingle USDC→WETH, then unwrap to native ETH. */
  private async swapUsdcToEth(amountUsdc: bigint): Promise<bigint> {
    const owner = this.deps.account.address;
    const allowance = await this.base.readContract({
      address: BASE_USDC, abi: ERC20_ABI, functionName: "allowance", args: [owner, BASE_SWAP_ROUTER],
    });
    if (allowance < amountUsdc) {
      const approveHash = await this.wallet.writeContract({
        chain: null, account: this.deps.account,
        address: BASE_USDC, abi: ERC20_ABI, functionName: "approve", args: [BASE_SWAP_ROUTER, amountUsdc],
      });
      await this.base.waitForTransactionReceipt({ hash: approveHash });
    }

    const ethBefore = await this.base.getBalance({ address: owner });

    // exactInputSingle to the router (recipient=router) then unwrapWETH9 to owner — atomic via multicall.
    const params = {
      tokenIn: BASE_USDC, tokenOut: BASE_WETH, fee: USDC_WETH_FEE,
      recipient: BASE_SWAP_ROUTER, amountIn: amountUsdc, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
    } as const;
    const { encodeFunctionData } = await import("viem");
    const swapData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [params] });
    // amountMinimum on the unwrap enforces slippage on the final ETH out.
    const unwrapMin = 0n; // refined below once we have a quote; see note
    const unwrapData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "unwrapWETH9", args: [unwrapMin, owner] });
    const hash = await this.wallet.writeContract({
      chain: null, account: this.deps.account,
      address: BASE_SWAP_ROUTER, abi: ROUTER_ABI, functionName: "multicall", args: [[swapData, unwrapData]],
    });
    await this.base.waitForTransactionReceipt({ hash });

    const ethAfter = await this.base.getBalance({ address: owner });
    const out = ethAfter - ethBefore;
    if (out <= 0n) throw new Error("swap produced no ETH");
    return out;
  }

  /** LI.FI quote for ETH(Base)→OG(0G) and send the bridge tx; poll for OG arrival. */
  private async bridgeEthToOg(ethAmount: bigint): Promise<bigint> {
    const owner = this.deps.account.address;
    const url = new URL(this.deps.lifiQuoteUrl ?? "https://li.quest/v1/quote");
    url.searchParams.set("fromChain", "8453");
    url.searchParams.set("toChain", "16661");
    url.searchParams.set("fromToken", "0x0000000000000000000000000000000000000000");
    url.searchParams.set("toToken", "0x0000000000000000000000000000000000000000");
    url.searchParams.set("fromAmount", ethAmount.toString());
    url.searchParams.set("fromAddress", owner);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`LI.FI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const q = (await res.json()) as { transactionRequest: { to: Hex; data: Hex; value: string; gasLimit?: string } };
    const tr = q.transactionRequest;

    const og = createPublicClient({ transport: http("https://evmrpc.0g.ai") }) as PublicClient;
    const ogBefore = await og.getBalance({ address: owner });

    const hash = await this.wallet.sendTransaction({
      chain: null, account: this.deps.account,
      to: tr.to, data: tr.data, value: BigInt(tr.value),
      ...(tr.gasLimit ? { gas: BigInt(tr.gasLimit) } : {}),
    });
    await this.base.waitForTransactionReceipt({ hash });

    let ogAfter = ogBefore;
    for (let i = 0; i < 60 && ogAfter <= ogBefore; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      ogAfter = await og.getBalance({ address: owner });
    }
    const delta = ogAfter - ogBefore;
    if (delta <= 0n) throw new Error("OG did not arrive within timeout (gas.zip can lag — re-run will pick it up)");
    return delta;
  }

  /** Deposit the bridged OG into the 0G compute ledger (units are whole OG). */
  private async depositToLedger(ogDelta: bigint): Promise<void> {
    const og = Number(formatEther(ogDelta));
    if (og <= 0) throw new Error("nothing to deposit");
    await this.deps.broker.ledger.depositFund(og);
  }
}
