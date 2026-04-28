---
name: oracle-pattern
description: Detect spot-price oracle reads in accounting paths; demand TWAP or Chainlink instead.
triggers: solidity, oracle, price, getReserves, slot0, Uniswap, Chainlink, liquidation, swap
---

# Skill: oracle-read audit

For any function that affects accounting (mint, redeem, swap, liquidate, borrow, etc.), find the price source:

1. Is it `getReserves()` from a Uniswap v2 pair? — flash-loan vulnerable, almost certainly HIGH.
2. Is it `slot0().sqrtPriceX96` from a Uniswap v3 pool? — same, HIGH.
3. Is it `(token.balanceOf(pair) / weth.balanceOf(pair))`? — same, HIGH.
4. Is it Chainlink's `latestRoundData`? — generally OK, but check the staleness:
   - `(uint80 roundId, int256 answer, , uint256 updatedAt, ) = aggregator.latestRoundData();`
   - require(answer > 0, "negative price");
   - require(updatedAt > block.timestamp - HEARTBEAT, "stale");
   - require(roundId == aggregator.latestRound() OR equivalent — depends on version)
5. Is it a TWAP using Uniswap v3's `observe()` over a non-trivial window? — generally OK.

## Red flags inside the same call

```solidity
uint256 price = pair.getReserves(); // <- spot
uint256 owed = collateralUsd / price; // <- consumed in same tx
```

This is the textbook setup for a flash-loan attack. Cite `patterns/oracle-manipulation.md`.

## Calibration

- Spot price on funds-moving path: HIGH.
- Chainlink read with no staleness check: MEDIUM.
- TWAP window < 30 min on a thin-liquidity pool: MEDIUM.
- Display-only price (no accounting impact): LOW or INFORMATIONAL.
