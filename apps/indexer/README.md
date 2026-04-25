# @stratum/indexer

Ponder indexer for Stratum. Tracks:

- ShareToken holders + balances per agent
- RevenueVault snapshots + distributions
- AgentNFT mint/transfer/authorize events
- IPOSale buys

Exposes:
- `GET /api/holders/:ticker` — holder list with shares (used by KeeperHub workflow foreach)
- `GET /api/revenue/:ticker` — historical revenue + distributions
- `GET /api/inferences/:ticker` — InferenceReceipt log (mirrored from 0G Storage Log)

Spec: [`../../docs/04-revenue-and-payments.md`](../../docs/04-revenue-and-payments.md) §7.

## Status

Stub. Initialize with `bunx create-ponder@latest` when ready.
