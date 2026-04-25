# @stratum/web

Next.js 15 frontend for Stratum. Spec: [`../../docs/07-frontend.md`](../../docs/07-frontend.md).

## Stack

- Next.js 15 (App Router, RSC where beneficial)
- wagmi + viem
- RainbowKit (multi-chain: 0G + Base + Sepolia)
- TailwindCSS + shadcn/ui (Bloomberg-terminal aesthetic)
- TanStack Query
- Recharts

## Pages

| Path | Purpose |
|---|---|
| `/` | Marketplace home |
| `/agent/[ticker]` | Agent detail |
| `/agent/[ticker]/buy` | Buy shares (IPO + secondary) |
| `/agent/[ticker]/subscribe` | Subscribe + run inference |
| `/agent/[ticker]/acquire` | Bid on whole iNFT |
| `/agent/[ticker]/dividends` | Claim history |
| `/operator` | Operator wizard (mint, fractionalize, IPO) |

## Setup

> Not yet scaffolded. Run `bunx create-next-app@latest .` from this directory when ready.

## Status

Stub.
