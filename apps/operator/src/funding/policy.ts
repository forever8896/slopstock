/**
 * Self-funding policy — the pure, money-safe core of the agent compute loop.
 *
 * Two decisions, both deterministic and side-effect-free so they can be tested
 * exhaustively before any real funds move:
 *
 *   computeSplit(amount, sliceBps) — at payment time, carve a compute slice off
 *     an inbound USDC payment; the rest (`net`) goes to the agent's RevenueVault.
 *     This is what makes an agent self-funding: it keeps a cut of every call to
 *     pay for its own inference, and shareholders earn net-of-compute.
 *
 *   decideTopup(input) — when the 0G compute ledger runs low, decide how much of
 *     the accumulated USDC reserve to spend refilling it, clamped by every safety
 *     limit (per-top-up cap, daily cap, and a reserve floor that is never
 *     breached). Returns 0 with a reason rather than ever over-spending.
 *
 * All amounts are bigint smallest-units (USDC = 6dp; OG = 18dp) — no floats.
 */

export interface Split {
  /** The compute reserve slice kept by the operator (USDC smallest units). */
  computeSlice: bigint;
  /** The remainder forwarded to the RevenueVault for shareholders. */
  net: bigint;
}

/**
 * Carve `sliceBps` basis points (1% = 100 bps) off `amount` as the compute
 * slice; the integer remainder is `net`. Floors the slice so a unit is never
 * created; `computeSlice + net === amount` always holds.
 */
export function computeSplit(amount: bigint, sliceBps: number): Split {
  if (!Number.isInteger(sliceBps) || sliceBps < 0 || sliceBps > 10_000) {
    throw new Error(`sliceBps must be an integer in [0, 10000], got ${sliceBps}`);
  }
  const computeSlice = (amount * BigInt(sliceBps)) / 10_000n;
  return { computeSlice, net: amount - computeSlice };
}

export interface TopupInput {
  /** Current 0G compute-ledger balance (OG smallest units). */
  ledgerOg: bigint;
  /** Refill when the ledger is strictly below this (OG smallest units). */
  thresholdOg: bigint;
  /** Configured top-up size to spend per trigger (USDC smallest units). */
  desiredTopupUsdc: bigint;
  /** Available compute reserve (USDC smallest units). */
  reserveUsdc: bigint;
  /** Reserve is never spent below this (USDC smallest units). */
  floorUsdc: bigint;
  /** Hard ceiling on a single top-up (USDC smallest units). */
  perTopupCapUsdc: bigint;
  /** USDC already auto-spent in the current 24h window. */
  spentTodayUsdc: bigint;
  /** Hard ceiling on auto-spend per 24h window (USDC smallest units). */
  dailyCapUsdc: bigint;
}

export interface TopupDecision {
  shouldTopup: boolean;
  /** USDC to spend (0 when shouldTopup is false). */
  amountUsdc: bigint;
  /** Human-readable explanation — surfaced in logs/alerts. */
  reason: string;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Decide whether (and how much) to refill the compute ledger. Spends only when
 * the ledger is below threshold, and clamps to the most restrictive of:
 * desired size, per-top-up cap, remaining daily allowance, spendable reserve
 * (reserve − floor). Returns shouldTopup=false with a reason if any limit
 * leaves nothing to spend.
 */
export function decideTopup(input: TopupInput): TopupDecision {
  if (input.ledgerOg >= input.thresholdOg) {
    return { shouldTopup: false, amountUsdc: 0n, reason: "ledger above threshold" };
  }

  const remainingDaily = max(0n, input.dailyCapUsdc - input.spentTodayUsdc);
  const spendableReserve = max(0n, input.reserveUsdc - input.floorUsdc);

  let amount = input.desiredTopupUsdc;
  amount = min(amount, input.perTopupCapUsdc);
  amount = min(amount, remainingDaily);
  amount = min(amount, spendableReserve);

  if (amount <= 0n) {
    const reason =
      remainingDaily <= 0n
        ? "daily cap reached"
        : spendableReserve <= 0n
          ? "reserve at/below floor"
          : "nothing to spend";
    return { shouldTopup: false, amountUsdc: 0n, reason };
  }

  return { shouldTopup: true, amountUsdc: amount, reason: "ledger below threshold; topping up" };
}
