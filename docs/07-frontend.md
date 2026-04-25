# 07 — Frontend

## 1. Goal

A tight, terminal-aesthetic web app that makes the pitch obvious in 30 seconds: **"this is a stock exchange for AI agents."** Bloomberg-inspired, dense, dark. Three core flows:

1. **Browse** — list of agents with tickers, prices, revenue
2. **Detail** — agent profile, performance, share market, subscribe
3. **Acquire** — bid on the whole iNFT (the dramatic demo button)

## 2. Tech stack

- **Next.js 15** (App Router, RSC where it helps, client components for wallet flows)
- **wagmi + viem** for chain reads/writes
- **RainbowKit** for wallet connect (supports 0G Chain + Base via custom chain configs)
- **TailwindCSS + shadcn/ui** — terminal/Bloomberg theme
- **Tanstack Query** for chain data caching
- **Zustand** for client-side cross-component state
- **Recharts** for revenue/price sparkline charts
- Hosted on **Vercel**

No CMS, no auth backend (wallet connect IS the auth).

## 3. Pages

```
/                              # marketplace home
/agent/[ticker]                # agent detail
/agent/[ticker]/buy            # buy shares (IPO + secondary)
/agent/[ticker]/subscribe      # subscribe → inference UI
/agent/[ticker]/acquire        # bid on whole iNFT
/agent/[ticker]/dividends      # claim history + claim now
/operator                      # operator console (mint, fractionalize, IPO)
/about                         # the pitch — what is Stratum
```

## 4. Page-by-page spec

### 4.1 `/` — Marketplace home

```
┌──────────────────────────────────────────────────────────────────┐
│  STRATUM   |   markets   |   operator   |   about     [connect]  │
├──────────────────────────────────────────────────────────────────┤
│  Total Agents Listed: 1   Cumulative Revenue: 12.50 USDC          │
│  ▌Active Subscribers: 4   ▌This Week's Distributions: 5.00 USDC   │
├──────────────────────────────────────────────────────────────────┤
│  TICKER       NAME                  PRICE     24H    REV/CALL  ▼  │
│  AUDIT      ▌auditor.stratum.eth   $1.00    +0%   1.0 USDC    ▌  │
│                                                                    │
│  (more rows for stretch agents)                                   │
└──────────────────────────────────────────────────────────────────┘
```

Components:
- `AgentTable` — server component, reads from indexer
- `MarketSummary` — totals across all agents
- `WalletConnect` — RainbowKit

Data sources:
- `/api/agents` from our Ponder indexer (list of agents)
- For each, on-chain reads via wagmi (current share price from IPOSale, total supply)

### 4.2 `/agent/[ticker]` — Agent detail

```
┌──────────────────────────────────────────────────────────────────┐
│  AUDIT  ▌auditor.stratum.eth                          [acquire]   │
│  Sealed Solidity audit agent. Ticker AUDIT.                       │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────┐ ┌──────────────────────────────┐│
│ │  PRICE & SHARES               │ │  TODAY                       ││
│ │  $1.00 / share                │ │  Calls today: 3              ││
│ │  300k / 1M sold (30%)         │ │  Revenue today: 3.00 USDC    ││
│ │  Mkt Cap: $1.0M               │ │  Total revenue: 12.50 USDC   ││
│ │  [buy shares]                 │ │  Last distribution: 4d ago   ││
│ └──────────────────────────────┘ └──────────────────────────────┘│
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  REVENUE (last 30 days)                                     │  │
│  │  ▁▁▂▃▂▅▇▇▆▅▃                                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  AGENT PROFILE                                                    │
│  Model:        qwen2.5-coder-32b (sealed)                         │
│  TEE:          Intel TDX, measurement 0x9a3f...                   │
│  iNFT:         0xAGENT_NFT.42                                     │
│  Share token:  0xSHARE_0G                                         │
│  Vault:        0xVAULT_BASE                                       │
│  ENS:          auditor.stratum.eth                                │
│                                                                   │
│  TOP HOLDERS                                                      │
│  0xOPERATOR    700,000  (70.0%)                                   │
│  0xINVESTOR_A  200,000  (20.0%)                                   │
│  0xINVESTOR_B  100,000  (10.0%)                                   │
│                                                                   │
│  RECENT INFERENCES (with attestations)                            │
│  • 2m ago — input hash 0xab… — verified ✓                         │
│  • 8m ago — input hash 0xcd… — verified ✓                         │
│  • 14m ago — input hash 0xef… — verified ✓                        │
│                                                                   │
│  [subscribe & try]                                                │
└──────────────────────────────────────────────────────────────────┘
```

Components:
- `AgentHeader`
- `PriceCard`, `RevenueCard`
- `RevenueChart` (Recharts sparkline)
- `AgentMetadataPanel`
- `HoldersTable`
- `RecentInferences` — pulled from 0G Log
- `SubscribeButton`, `AcquireButton`

### 4.3 `/agent/[ticker]/buy`

Two tabs: **IPO** (if open) and **secondary**.

```
[ IPO  ●  | secondary ]

   Buy AUDIT shares at the IPO price.

   Price:        $1.00 per share
   Available:    278,500 / 300,000 (92.8% sold)
   Sale ends:    2026-04-26 14:00 UTC

   You buy:      [______] shares
   You pay:      $___ USDC.base

   [ buy 1,000 AUDIT for $1,000 ]
```

Mechanics:
- Confirms USDC approval, then `IPOSale.buy()` in single multicall
- After confirmation, refresh holder list

For the demo we use small numbers (10 shares for $10) so judges can actually click the button live without spending much testnet USDC.

### 4.4 `/agent/[ticker]/subscribe`

```
   Subscribe to AUDIT

   Cost:         1 USDC per call
   Pay with:     [ USDC ▼ | PEPE | DAI | ETH | ... ]
   Authorize:    1 hour    (or per-call)

   [ pay 1 USDC and run inference now ]

   ─── once paid: ──────────────────────────────────────────────────

   Paste Solidity code:
   [────────────────────────────────────────────────────────────────]
   [                                                                ]
   [────────────────────────────────────────────────────────────────]

   [ run audit ]

   ─── output: ─────────────────────────────────────────────────────

   ✓ TEE attestation verified — Intel TDX, measurement 0x9a3f…
   Findings (3):
     [HIGH] Reentrancy in withdraw()    location: line 42
     [MED]  Missing nonReentrant guard  location: line 17
     ...
```

Components:
- `TokenPicker` — uses Uniswap pay-with-any-token under the hood
- `SubscribeButton` — triggers x402 payment + authorizeUsage on-chain
- `InferenceForm`
- `AttestationBanner` — green if verified, red if not — verified client-side via `verifyReceipt()` from doc 03 §10

### 4.5 `/agent/[ticker]/acquire` — the headline demo flow

```
   Acquire AUDIT (whole iNFT)

   Current best bid:  $50,000 (0xACQUIRER, expires in 48h)
   Last sale:         never
   Mkt cap (shares):  $1,000,000 (1M × $1)

   Your bid:    [_______]  USDC.base
   Bidder pubkey (will receive sealed weights):
                [auto-derived from your wallet ▼ | paste pubkey]
   Expires in:  [ 48h ▼ ]

   [ post bid ]

   ─── for operator: ────────────────────────────────────────────────

   Best bid: $50,000 from 0xACQUIRER.

   [ accept bid → trigger TEE re-encryption + iTransfer ]

   This will:
     1. Generate a fresh content key inside Intel TDX
     2. Re-encrypt your weights, system prompt, and RAG corpus
     3. Seal the new key under 0xACQUIRER's pubkey
     4. Transfer the iNFT
     5. Atomically clear all 4 active subscriber grants
     6. Flip the ENS resolver to point at 0xACQUIRER

   [ I understand. Acquire. ]
```

This is the most important page for the demo. Big buttons, clear copy. The judges should *see* the cryptographic weight of what just happened.

After acceptance, redirect to a confirmation page showing:
- ✓ TEE re-encryption attestation hash
- ✓ iTransfer event
- ✓ All 4 prior `authorizeUsage` grants cleared (red strikethrough)
- ✓ ENS resolver updated (live re-fetch shows new owner)

### 4.6 `/agent/[ticker]/dividends`

Shareholder-facing claim history.

```
   Your AUDIT dividends

   You own:       100,000 AUDIT (10.0%)
   Estimated APY: ~12% (based on last 4 weeks)

   Snapshot       Total Distributed    Your share    Status
   #4   ▌7d ago   5.0 USDC             0.50 USDC     ✓ received
   #3   ▌14d ago  4.2 USDC             0.42 USDC     ✓ received
   #2   ▌21d ago  3.8 USDC             0.38 USDC     ✓ received
   #1   ▌28d ago  2.5 USDC             0.25 USDC     ✓ received

   [ claim manually for missed snapshot — disabled ]
```

Standard dividend ledger UI. Calls the indexer for past snapshots; for "received," cross-references the holder's USDC tx history.

### 4.7 `/operator` — Mint + manage console

For the team to use during the demo (and post-hackathon, real operators).

```
   STRATUM OPERATOR CONSOLE

   1. Upload model + system prompt + corpus → 0G Storage
   2. Encrypt and submit for sealing → 0G Compute TEE
   3. Mint iNFT → 0G Chain
   4. Fractionalize → mint ShareToken
   5. Configure IPO → set price, allocation, duration
   6. Register ENS → set resolver, text records
   7. Deploy KeeperHub workflow → revenue distribution
   8. Register on ERC-8004 → discovery

   [ start the wizard ]
```

A multi-step wizard. We pre-fill defaults so the demo runs fast.

## 5. Cross-cutting components

| Component | Purpose |
|---|---|
| `WalletConnect` (RainbowKit) | Wallet auth, multi-chain |
| `ChainSwitcher` | Toggle between 0G Chain (for iNFT/shares) and Base (for vault/x402) |
| `AttestationBadge` | Green/red badge that verifies a TEE quote in-browser |
| `EnsCard` | Reads + displays an agent's ENSIP-25 record set |
| `TxToast` | Bottom-right transaction status w/ explorer link |
| `Numeric` | Formats USDC (6 decimals), shares (18 decimals) safely |

## 6. Visual / brand direction

- Background: `#0a0a0a` (near-black)
- Primary text: `#e5e5e5`
- Accents: a single `#10b981` (green) for "verified / paid / received" states; a single `#ef4444` (red) for failures
- Font: monospace UI (JetBrains Mono or IBM Plex Mono)
- Borders: 1px solid `#262626`
- No gradients, no glows, no logos with eyes/sparkles. The aesthetic is "Bloomberg terminal at 2am."
- Logo: `[ ▌ stratum ]` in mono, that's it.

## 7. Wallet UX details

- Use Base + 0G Chain simultaneously. RainbowKit's `defaultConfig` with both chain configs.
- Auto-switch chain when user clicks a button that needs the other chain (`useSwitchChain`).
- Make it obvious which chain each action is on with a chain badge next to every button: `[ buy shares (Base) ]`, `[ acquire iNFT (0G) ]`.

## 8. Data fetching strategy

- **Static / list views** → server components, indexer-backed
- **Real-time mutations** → client components, wagmi + tanstack-query
- **Inference call** → client → operator MCP server (via subscriber's local AXL) — *not* through our backend
- **Indexer** runs as a separate Vercel project (Ponder) with `/api/holders/:ticker`, `/api/revenue/:ticker`, `/api/inferences/:ticker`

## 9. Demo dressing

To make the demo land, we pre-load:

- 4 simulated past snapshots showing dividends paid (so the dividends page isn't empty)
- ~10 historical inferences in the recent-inferences panel
- 2 prior holders with sub-percent shares so the holders table isn't a 1-row demo

These are real data points — not fake — generated by running the system for an hour before the demo. We don't lie about scale.

## 10. Build cost

| Piece | LoC | Person-hours |
|---|---|---|
| Project scaffold + theme | ~200 | 2h |
| Marketplace home | ~250 | 3h |
| Agent detail page | ~500 | 6h |
| Buy / IPO page | ~300 | 4h |
| Subscribe page | ~400 | 5h |
| Acquire page | ~350 | 5h |
| Dividends page | ~250 | 3h |
| Operator console wizard | ~700 | 10h |
| Cross-cutting components | ~500 | 5h |
| **Total** | ~3,450 | **~43h** |

This is the largest single workstream. Need 2 frontend devs ideally, or 1 fast frontend dev who knows wagmi/viem cold + minimal scope (we cut operator console first if behind).

## 11. Cut order (if behind schedule)

| Cut | Lose | Save |
|---|---|---|
| **First cut:** Operator console wizard → Foundry script | Pretty mint UX | 10h |
| **Second cut:** Dividends page → just show "see vault on explorer" | Slick claim UX | 3h |
| **Third cut:** Buy/IPO page → CLI to demo | Live "buy shares" demo moment | 4h |
| **Fourth cut:** Sparkline charts | Polish | 2h |
| **Never cut:** Subscribe page, Acquire page, Detail page header | Demo collapses | — |

The minimum viable frontend is: detail + subscribe + acquire. That's the hero arc.
