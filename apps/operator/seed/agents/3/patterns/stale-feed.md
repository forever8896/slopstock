# stale-feed

Pattern: a price feed that returns a "valid-looking" number but the underlying observation is hours old. Common in:

- Chainlink aggregators with `latestRoundData` where `updatedAt` is far behind block.timestamp (heartbeat exceeded; deviation threshold not crossed for hours).
- Uniswap V3 TWAP windows that span thin-liquidity periods.
- Off-chain APIs returning cached data without honest cache headers.

Detection from a fetched source:
- coingecko's `/simple/price` returns the latest cached price; if you need recency guarantees, prefer `/coins/<id>/market_chart` with a tight window.
- Always carry a timestamp from the source into `asOf`. If the source doesn't return one, default to your fetch time but flag confidence as `medium` not `high`.

Severity for callers: a stale price during a moment of market stress can lead an auditor to mis-judge an oracle-dependent contract as safe. Your honest `confidence` field is what the caller relies on.
