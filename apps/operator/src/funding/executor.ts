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

// ── Chain configuration ──────────────────────────────────────────────────────
// The self-funding loop runs on its OWN chain config, deliberately decoupled
// from the app-wide BASE_RPC_URL (which points at Base Sepolia for x402 +
// finance). Real revenue and the 0G compute ledger live on mainnet, so that's
// the default here — but every field is overridable so the whole leg can be
// rehearsed on testnet without ever touching the mainnet wallet.

export type FundingNetwork = "mainnet" | "testnet";

export interface ChainConfig {
  network: FundingNetwork;
  /** EVM chain id of the Base side (LI.FI fromChain). */
  baseChainId: number;
  /** RPC the swap + bridge txs are sent through. */
  baseRpcUrl: string;
  usdc: Hex;
  weth: Hex;
  /** Uniswap V3 SwapRouter02. */
  swapRouter: Hex;
  /** Uniswap V3 QuoterV2 — used to price the swap and set a real min-out. */
  quoter: Hex;
  /** Pool fee tier (500 = 0.05%, the deepest small-trade tier for USDC/WETH). */
  poolFee: number;
  /** EVM chain id of the 0G side (LI.FI toChain). */
  ogChainId: number;
  /** RPC used to watch for the bridged OG arriving. */
  ogRpcUrl: string;
}

/**
 * Canonical addresses. Mainnet values are the verified Uniswap V3 + token
 * deployments on Base mainnet and the 0G mainnet chain id. Testnet values are
 * Base Sepolia / 0G Galileo — present so the plumbing can be rehearsed, but a
 * liquid USDC/WETH pool may not exist there, so treat testnet as a dry-run of
 * the *mechanics* and override any address that has moved.
 */
const PRESETS: Record<FundingNetwork, ChainConfig> = {
  mainnet: {
    network: "mainnet",
    baseChainId: 8453,
    baseRpcUrl: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth: "0x4200000000000000000000000000000000000006",
    swapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    poolFee: 500,
    ogChainId: 16661,
    ogRpcUrl: "https://evmrpc.0g.ai",
  },
  testnet: {
    network: "testnet",
    baseChainId: 84532,
    baseRpcUrl: "https://base-sepolia-rpc.publicnode.com",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    weth: "0x4200000000000000000000000000000000000006",
    swapRouter: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
    quoter: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
    poolFee: 500,
    ogChainId: 16601,
    ogRpcUrl: "https://evmrpc-testnet.0g.ai",
  },
};

/**
 * Resolve the funding-loop chain config from env. `SELF_FUND_NETWORK` picks the
 * preset (default mainnet); any individual field can be overridden so a moved
 * router/quoter or a custom RPC never requires a code change.
 */
export function resolveChainConfig(env: Record<string, string | undefined> = process.env): ChainConfig {
  const network: FundingNetwork = env.SELF_FUND_NETWORK === "testnet" ? "testnet" : "mainnet";
  const p = PRESETS[network];
  const num = (v: string | undefined, dflt: number) => (v != null && v !== "" ? Number(v) : dflt);
  const addr = (v: string | undefined, dflt: Hex) => (v ? (v as Hex) : dflt);
  return {
    network,
    baseChainId: num(env.SELF_FUND_BASE_CHAIN_ID, p.baseChainId),
    baseRpcUrl: env.SELF_FUND_BASE_RPC_URL || p.baseRpcUrl,
    usdc: addr(env.SELF_FUND_USDC, p.usdc),
    weth: addr(env.SELF_FUND_WETH, p.weth),
    swapRouter: addr(env.SELF_FUND_SWAP_ROUTER, p.swapRouter),
    quoter: addr(env.SELF_FUND_QUOTER, p.quoter),
    poolFee: num(env.SELF_FUND_POOL_FEE, p.poolFee),
    ogChainId: num(env.SELF_FUND_OG_CHAIN_ID, p.ogChainId),
    ogRpcUrl: env.SELF_FUND_OG_RPC_URL || p.ogRpcUrl,
  };
}

// ── Back-compat exports (mainnet preset values) ──────────────────────────────
export const BASE_USDC: Hex = PRESETS.mainnet.usdc;
export const BASE_WETH: Hex = PRESETS.mainnet.weth;
/** Uniswap V3 SwapRouter02 on Base mainnet. */
export const BASE_SWAP_ROUTER: Hex = PRESETS.mainnet.swapRouter;
/** USDC/WETH 0.05% pool is the deepest small-trade tier on Base. */
export const USDC_WETH_FEE = PRESETS.mainnet.poolFee;

/**
 * Apply a slippage tolerance (in bps) to an amount, returning the minimum
 * acceptable output. Pure + clamped to [0, 100%] so a bad env value can never
 * widen the guard beyond "accept nothing worse than zero".
 */
export function applySlippage(amount: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (amount * (10_000n - bps)) / 10_000n;
}

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

// Uniswap V3 QuoterV2: quoteExactInputSingle simulates the swap (reverts to
// return data) so we can price the trade and set a real amountOutMinimum.
const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** Read the operator's USDC balance on Base (the accrued compute reserve). */
export async function readUsdcBalance(
  client: PublicClient,
  owner: Hex,
  token: Hex = BASE_USDC,
): Promise<bigint> {
  return client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
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
  /** Self-consistent chain config (RPC + addresses + chain ids) for this leg. */
  chain: ChainConfig;
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
    this.base = createPublicClient({ transport: http(deps.chain.baseRpcUrl) }) as PublicClient;
    this.wallet = createWalletClient({ account: deps.account, transport: http(deps.chain.baseRpcUrl) });
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

  /**
   * Quote USDC→WETH on the configured pool via QuoterV2. Returns the expected
   * WETH-out (== ETH-out after the 1:1 unwrap). Simulated via eth_call — moves
   * nothing, costs no gas.
   */
  private async quoteEthOut(amountUsdc: bigint): Promise<bigint> {
    const { chain } = this.deps;
    try {
      const { result } = await this.base.simulateContract({
        address: chain.quoter,
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: chain.usdc, tokenOut: chain.weth, amountIn: amountUsdc, fee: chain.poolFee, sqrtPriceLimitX96: 0n }],
        account: this.deps.account.address,
      });
      const out = (result as readonly bigint[])[0];
      if (typeof out !== "bigint" || out <= 0n) throw new Error("quoter returned zero");
      return out;
    } catch (err) {
      throw new Error(`USDC→ETH quote failed (pool ${chain.usdc}/${chain.weth} fee ${chain.poolFee}): ${(err as Error).message}`);
    }
  }

  /** Approve (if needed) + Uniswap V3 exactInputSingle USDC→WETH, then unwrap to native ETH. */
  private async swapUsdcToEth(amountUsdc: bigint): Promise<bigint> {
    const { chain } = this.deps;
    const owner = this.deps.account.address;

    // Price the swap first so we can set a real min-out (slippage guard).
    const expectedEthOut = await this.quoteEthOut(amountUsdc);
    const minOut = applySlippage(expectedEthOut, this.deps.slippageBps);
    if (minOut <= 0n) throw new Error("computed min-out is zero — refusing unguarded swap");

    const allowance = await this.base.readContract({
      address: chain.usdc, abi: ERC20_ABI, functionName: "allowance", args: [owner, chain.swapRouter],
    });
    if (allowance < amountUsdc) {
      const approveHash = await this.wallet.writeContract({
        chain: null, account: this.deps.account,
        address: chain.usdc, abi: ERC20_ABI, functionName: "approve", args: [chain.swapRouter, amountUsdc],
      });
      await this.base.waitForTransactionReceipt({ hash: approveHash });
    }

    const ethBefore = await this.base.getBalance({ address: owner });

    // exactInputSingle to the router (recipient=router) then unwrapWETH9 to owner — atomic via multicall.
    // amountOutMinimum on the swap AND amountMinimum on the unwrap both enforce
    // the quoted-minus-slippage floor, so a sandwich/price-move reverts the tx.
    const params = {
      tokenIn: chain.usdc, tokenOut: chain.weth, fee: chain.poolFee,
      recipient: chain.swapRouter, amountIn: amountUsdc, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
    } as const;
    const { encodeFunctionData } = await import("viem");
    const swapData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [params] });
    const unwrapData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "unwrapWETH9", args: [minOut, owner] });
    const hash = await this.wallet.writeContract({
      chain: null, account: this.deps.account,
      address: chain.swapRouter, abi: ROUTER_ABI, functionName: "multicall", args: [[swapData, unwrapData]],
    });
    await this.base.waitForTransactionReceipt({ hash });

    const ethAfter = await this.base.getBalance({ address: owner });
    const out = ethAfter - ethBefore;
    if (out <= 0n) throw new Error("swap produced no ETH");
    return out;
  }

  /** LI.FI quote for ETH(Base)→OG(0G) and send the bridge tx; poll for OG arrival. */
  private async bridgeEthToOg(ethAmount: bigint): Promise<bigint> {
    const { chain } = this.deps;
    const owner = this.deps.account.address;
    const url = new URL(this.deps.lifiQuoteUrl ?? "https://li.quest/v1/quote");
    url.searchParams.set("fromChain", String(chain.baseChainId));
    url.searchParams.set("toChain", String(chain.ogChainId));
    url.searchParams.set("fromToken", "0x0000000000000000000000000000000000000000");
    url.searchParams.set("toToken", "0x0000000000000000000000000000000000000000");
    url.searchParams.set("fromAmount", ethAmount.toString());
    url.searchParams.set("fromAddress", owner);
    url.searchParams.set("slippage", String(this.deps.slippageBps / 10_000));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`LI.FI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const q = (await res.json()) as { transactionRequest: { to: Hex; data: Hex; value: string; gasLimit?: string } };
    const tr = q.transactionRequest;

    const og = createPublicClient({ transport: http(chain.ogRpcUrl) }) as PublicClient;
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
