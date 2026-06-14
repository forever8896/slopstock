/**
 * Payment-split configuration + helpers, read from env so the live x402 path can
 * route a compute slice to the operator reserve without code changes.
 *
 * DEFAULT OFF: with COMPUTE_SLICE_BPS unset/0 or no reserve address, every helper
 * is inert and the payment path behaves exactly as before (subscriber → vault).
 *
 * When enabled, the agent's `payTo` becomes the operator reserve address and the
 * operator forwards `net` (= amount − slice) to the vault after settlement — the
 * sequential equivalent of an atomic split (EIP-3009 settles to one payee).
 */

import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { computeSplit } from "./policy.ts";

export interface SplitConfig {
  enabled: boolean;
  sliceBps: number;
  /** Operator reserve address that receives the full call payment when enabled. */
  reserveAddress: Hex | null;
}

/** Read split config from env. Inert unless both a positive bps and address are set. */
export function readSplitConfig(env: NodeJS.ProcessEnv = process.env): SplitConfig {
  const sliceBps = Number(env.COMPUTE_SLICE_BPS ?? "0");
  const reserveAddress = (env.COMPUTE_RESERVE_ADDRESS ?? "").trim() as Hex | "";
  const enabled = Number.isFinite(sliceBps) && sliceBps > 0 && sliceBps <= 10_000 && reserveAddress.length === 42;
  return { enabled, sliceBps: enabled ? sliceBps : 0, reserveAddress: enabled ? (reserveAddress as Hex) : null };
}

/**
 * Resolve the x402 `payTo` for a call. When the split is enabled, payments go to
 * the operator reserve; otherwise straight to the vault (unchanged behavior).
 */
export function resolvePayTo(vault: Hex, cfg: SplitConfig): Hex {
  return cfg.enabled && cfg.reserveAddress ? cfg.reserveAddress : vault;
}

const USDC_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/**
 * Forward the shareholders' net (amount − compute slice) from the operator
 * reserve to the vault. Fire-and-forget from the request path; failures are the
 * caller's to log. Requires OPERATOR_PRIVATE_KEY + Base gas. Returns the tx hash.
 */
export async function forwardNetToVault(args: {
  amountSmallest: bigint;
  vault: Hex;
  sliceBps: number;
  usdc: Hex;
  rpcUrl: string;
  operatorKey: Hex;
}): Promise<{ net: bigint; hash: Hex }> {
  const { net } = computeSplit(args.amountSmallest, args.sliceBps);
  if (net <= 0n) return { net: 0n, hash: "0x" as Hex };
  const account = privateKeyToAccount(args.operatorKey);
  const wallet = createWalletClient({ account, transport: http(args.rpcUrl) });
  const pub = createPublicClient({ transport: http(args.rpcUrl) });
  const hash = await wallet.writeContract({
    chain: null, account,
    address: args.usdc, abi: USDC_ABI, functionName: "transfer", args: [args.vault, net],
  });
  await pub.waitForTransactionReceipt({ hash });
  return { net, hash };
}
