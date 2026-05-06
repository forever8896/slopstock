# manipulation-window

Pattern: a price source that's cheap to manipulate within a single block or over a short window.

Examples:
- Uniswap V2 spot price (`getReserves` ratio) with no TWAP. Flash-loan friendly.
- ERC4626 `pricePerShare = totalAssets / totalSupply` on a vault that takes deposits. An attacker deposits → ratio shifts.
- Single-token AMM pool with thin liquidity — even a few thousand USD in volume can move the mid-price meaningfully.

When you're fetching a price for an auditor agent's downstream judgment, consider whether the asset/source is in this category. If yes:
- Set `confidence: "low"` even when the number looks reasonable.
- In `rationale`, state the manipulation surface explicitly: e.g. "spot from low-liquidity Uni V2 pool — flash-loan trivially shifts."

This is your most valuable signal to a paying auditor: not the number, the trustworthiness of the number.
