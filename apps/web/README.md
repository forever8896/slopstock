# @stratum/web

Next.js 15 frontend for Stratum. Spec: [`../../docs/07-frontend.md`](../../docs/07-frontend.md).

## Stack

- Next.js 15 + React 19 (App Router)
- wagmi v2 + viem v2 + RainbowKit
- TailwindCSS — terminal/Bloomberg theme
- TanStack Query

## Pages

| Path | Status |
|---|---|
| `/` | ✅ marketplace home (mock data) |
| `/agent/[ticker]` | ✅ agent detail (mock data) |
| `/agent/[ticker]/buy` | ⬜ not yet |
| `/agent/[ticker]/subscribe` | ⬜ not yet |
| `/agent/[ticker]/acquire` | ⬜ not yet |
| `/agent/[ticker]/dividends` | ⬜ not yet |
| `/operator` | ⬜ not yet |

## Layout

```
src/
├── app/
│   ├── layout.tsx        root layout with providers + nav
│   ├── providers.tsx     WagmiProvider + RainbowKit + TanStack Query
│   ├── page.tsx          marketplace home
│   ├── agent/[ticker]/page.tsx  agent detail
│   └── globals.css       tailwind + theme
├── components/
│   ├── nav.tsx
│   ├── mock-banner.tsx   honest "this is mock data" indicator
│   ├── agent-table.tsx
│   ├── market-summary.tsx
│   ├── agent-header.tsx
│   ├── stat-card.tsx
│   ├── holders-table.tsx
│   ├── recent-inferences.tsx
│   └── metadata-panel.tsx
└── lib/
    ├── wagmi.ts          chain configs (0G + Base Sepolia + Sepolia) + RainbowKit
    ├── mock.ts           hero agent + holders + snapshots + inferences
    └── format.ts         shortAddr, formatUsdc, formatShares, pctOf, relativeTime
```

## Run

```bash
bun install            # from repo root
bun dev:web            # http://localhost:3000
```

Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` if you want WalletConnect to work cleanly; without it RainbowKit warns but still renders.

## Mock data policy

Anywhere mock data is rendered, a `[mock]` badge is shown via `<MockBanner />` or inline labels. When the indexer (`@stratum/indexer`) lands, swap in real data — the mock shapes already match the planned indexer JSON, so the swap is mechanical.

## Status

- [x] Marketplace home (table + summary)
- [x] Agent detail (header, price/revenue cards, profile, holders, inferences)
- [x] Wallet connect via RainbowKit, multi-chain (0G + Base Sepolia + Sepolia)
- [ ] Buy / IPO page
- [ ] Subscribe page (wires to operator MCP)
- [ ] Acquire page (the headline acquisition flow)
- [ ] Dividends page
- [ ] Operator wizard
