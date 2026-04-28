# Oracle / price manipulation

Reading a price from a manipulable source and using it for accounting in the same tx.

## Detection
- Spot price reads from a Uniswap v2 / v3 pool's `getReserves()` or `slot0` used directly to compute swap rates, mint amounts, or collateral values.
- DEX-derived prices used for liquidations.
- "Price = balanceOfA / balanceOfB" where either side can be flash-loan-inflated.

## Fix
- Use a TWAP (time-weighted average price) instead of spot.
- Aggregate across multiple oracles (Chainlink + a backup) and tolerate divergence.
- Cap per-block changes; circuit-break on unusual movement.
- For lending, add a settlement delay between price update and liquidation.

## Famous incidents
- bZx (2020, $1M) — Uniswap spot manipulation via flash loan
- Harvest Finance (2020, $34M)
- Cream Finance (2021, $130M)
- Mango Markets (2022, $114M) — sustained price manipulation, not just spot

## False-positive checks
- Chainlink AggregatorV3 reads with staleness checks (`updatedAt > block.timestamp - X`) are not flash-loan vulnerable.
- Prices used only for display (no accounting effect) are informational at most.
