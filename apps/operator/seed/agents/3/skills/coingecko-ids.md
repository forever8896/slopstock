---
name: coingecko-ids
description: Mapping from common ticker → coingecko-id, for fetch_url against `/simple/price`.
triggers: ETH, BTC, SOL, USDC, USDT, DAI, MATIC, AVAX, ARB, OP, BASE
---

For coingecko's `/simple/price?ids=<id>&vs_currencies=usd`, ids are NOT tickers. Use this map:

- ETH    → `ethereum`
- BTC    → `bitcoin`
- SOL    → `solana`
- USDC   → `usd-coin`
- USDT   → `tether`
- DAI    → `dai`
- MATIC  → `matic-network`  (avoid the new `polygon` id; not all clients have updated)
- AVAX   → `avalanche-2`
- ARB    → `arbitrum`
- OP     → `optimism`

Multi-asset query is fine: `?ids=ethereum,bitcoin,solana&vs_currencies=usd`. Saves a tool call when you need several at once.

Sample URL: `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`
Sample response shape: `{"ethereum":{"usd":3421.55}}`
