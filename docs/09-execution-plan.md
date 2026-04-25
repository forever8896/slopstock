# 09 — Execution Plan

## 1. Assumptions

- **Hackathon length:** 36-48 hours, hacking only (we add ~4 hours buffer for video/submission)
- **Team size:** 3-4 people (this plan is written for **4**; with 3, fold "ML/data" into "backend")
- **Skill mix:** 1 contracts dev (Foundry/Solidity), 1 backend (Node/TS, MCP/x402/AXL), 1 frontend (Next.js/wagmi), 1 ML/data (LoRA + corpus) OR a generalist
- **Day 0:** all infrastructure accounts provisioned (Vercel, KeeperHub, 0G testnet faucet, GitHub repo, Cloudflare Worker for ENS gateway)

## 2. Roles

| Role | Owner | Workstreams |
|---|---|---|
| **Captain / integration** | (rotating) | Cross-team unblocks, demo prep, video, submission |
| **Contracts** | C | iNFT fork + extensions, ShareToken, Fractionalizer, IPOSale, RevenueVault, Marketplace, Resolver |
| **Backend** | B | Operator node, MCP server, x402 gateway, 0G Compute integration, ENS gateway worker, KeeperHub workflow, Ponder indexer |
| **Frontend** | F | Next.js app, wagmi integration, all pages |
| **ML / hero agent** | M | LoRA training, RAG corpus, system prompt, sealed upload, demo contracts |

If team is 3: M's load shrinks to "system prompt + RAG corpus only" (no LoRA training); B picks up the upload-and-encrypt scripts.

## 3. Hour-by-hour plan (48h budget)

### **Day 0 (pre-hackathon, t < 0)** — 4-6h

| Hour | Task | Owner |
|---|---|---|
| -6 | Provision: 0G Galileo testnet wallet + faucet drip; Base Sepolia testnet; KeeperHub account + API key; Vercel project; Cloudflare Worker; GitHub repo `stratum/`; ENS Sepolia `stratum.eth` registration | Captain |
| -5 | Read all sponsor docs once: 0G iNFT spec, AXL setup, KeeperHub MCP API, Uniswap pay-with-any-token, ENS CCIP-Read | All |
| -4 | Confirm at sponsor booths (or via Discord): Sealed Executor available? KeeperHub workflow can read Base? AXL bootstrap address? | Captain |
| -3 | Decision log fills: TEE vs ZKP, Vault chain (Base vs 0G), single-agent vs two-agent | All |
| -2 | Forge new repo, push initial scaffold (Foundry + Next.js + node-operator skeleton + ENS gateway skeleton) | All |
| -1 | Team alignment on the demo arc; everyone reads the master PRD | All |
| 0 | **Hack starts** | — |

### **Hours 0-6 — Foundations in parallel**

Everyone writes "their slice" with mocks at the boundaries. Goal: by hour 6, every component has its skeleton + a passing test against mocks.

| Hour | C (contracts) | B (backend) | F (frontend) | M (ML) |
|---|---|---|---|---|
| 0-2 | Fork `0g-agent-nft`, get it building locally with Foundry | AXL daemons up on 2 machines; talk over `/send` `/recv` | Next.js scaffold, wagmi+RainbowKit on 0G+Base, base layout | Scrape Code4rena dataset, format pairs |
| 2-4 | `ShareToken`, `Fractionalizer` written + tested | MCP server skeleton, register `stratum.agent.profile` | Marketplace home + agent detail page (with mock data) | LoRA training kicks off (background) |
| 4-6 | `RevenueVault` (snap + claim) | x402 gateway skeleton: serves 402 with metadata, validates against mock facilitator | Subscribe page (no payment yet, mock) | Compose system prompt + RAG corpus (~5MB) |

**Hour 6 checkpoint:** Stand-up. Everyone reports "what's mocked, what's real." Captain decides cuts if anyone is > 30% behind.

### **Hours 6-12 — Real integrations begin**

| Hour | C | B | F | M |
|---|---|---|---|---|
| 6-8 | `IPOSale` written + tested | Wire MCP infer to 0G Compute (real call! TEEML proof returned) | Wire `buy shares` to real `IPOSale` contract | Encrypt LoRA + corpus, upload to 0G Storage |
| 8-10 | `Marketplace` accept flow w/ mock TEE oracle | x402 → real Coinbase facilitator on Base testnet | Subscribe page wires to operator MCP via AXL | First end-to-end inference test (M + B) |
| 10-12 | `AgentRegistry`, deploy all to 0G Galileo | Ponder indexer started: indexes Transfer events, holders | Acquire page UI complete (mock data) | Eval LoRA on holdouts; iterate if needed |

**Hour 12 checkpoint:** First **vertical slice** — mint → buy → subscribe → infer — runs on testnet with real chains and real inference (mocked attestations OK at this stage). If this slice doesn't work by hour 12, **pull risk-and-cuts.md and trim now, not at hour 30.**

### **Hours 12-18 — Sealing, ENS, KeeperHub**

| Hour | C | B | F | M |
|---|---|---|---|---|
| 12-14 | `StratumResolver` (CCIP-Read) on Sepolia | ENS gateway worker on Cloudflare; rotating addresses + signed responses | Operator console mint wizard — step 1 (upload + encrypt) | Train LoRA-v2 if v1 weak; otherwise refine system prompt |
| 14-16 | Resolver tests w/ EIP-3668 client | Set ENSIP-25 text records on `auditor.stratum.eth` | Operator wizard step 2-4 (mint, fractionalize, IPO-config) | Demo contracts staged + expected outputs locked |
| 16-18 | Marketplace acceptance integrated w/ real TEE oracle (or fallback to mock + label) | KeeperHub workflow created via MCP API; ERC-8004 register | Acquire page wires to real `Marketplace.postBid` + `accept` | Hand off everything to B for the operator node bundle |

**Hour 18 checkpoint:** Everything **integrated end-to-end on testnet.** No "trust me" moments. Begin demo polish.

### **Hours 18-30 — Demo polish + the hard stuff**

| Hour | C | B | F | M |
|---|---|---|---|---|
| 18-22 | Bug fixes from integration; cross-chain registry mapping | Operator node bundled (Docker if time); subscriber CLI tightened | Subscribe page: full flow incl. `pay-with-any-token` integration | Pre-record fallback audit run (in case of demo issues) |
| 22-24 | Final deploy to canonical addresses; verify on explorers | KeeperHub workflow tested w/ real distribute | Dividends page; recent-inferences panel with real 0G Log reads | Demo dataset pre-seeded into vault to make page non-empty |
| 24-28 | (slack — help frontend or unblock blocker) | (slack — help frontend) | All visual polish; chain switcher; tx toasts; load states | (slack — help frontend) |
| 28-30 | Captain demo dry-run #1 with full team | All | All | All |

**Hour 30 checkpoint:** *We have a working demo.* From here on, every change has a higher chance of breaking than fixing.

### **Hours 30-42 — Hardening, video, submission**

| Hour | Task | Owner |
|---|---|---|
| 30-32 | Demo dry-run #1 → fix what fails | All |
| 32-34 | Demo dry-run #2 → record video B-roll (silent screen captures of each flow) | Captain + F |
| 34-36 | Write README; architecture diagram in PNG; `FEEDBACK.md` for Uniswap; short writeup per sponsor | Captain |
| 36-38 | Record final demo video (3min, voice-over + screen capture) | Captain |
| 38-40 | Submit to ETHGlobal; per-sponsor submission per `11-demo-and-submission.md` | Captain |
| 40-42 | Tweet/X thread; sleep | All |

### **Hours 42-48 — Buffer**

Reserved for things going wrong. Do **not** plan features here. Use only if:
- Submission flow rejected and needs fixing
- A sponsor follows up with a question
- Demo URL goes down
- A judge tries the demo live and hits an issue

## 4. Dependency graph

```
                                      mint flow
                                          │
   AgentNFT(C) ─────────┐                 │
                        ▼                 │
             Fractionalizer(C) ──┐        │
                                  ▼        │
                         ShareToken (C)    │
                                  │        │
                                  ▼        │
   RevenueVault(C) ◀── Fractionalize ◀──── operator wizard(F)
        │                         │             │
        │                         │             │
        ▼                         │             │
   KeeperHub workflow(B)          │             │
        │                         │             │
        ▼                         │             │
   distribution        ◀──── Ponder indexer(B)  │
                                  │             │
                                  │             │
                                  ▼             │
                          IPOSale(C) ◀── buy page(F)
                                  │             │
                                  ▼             │
                          investor wallet ◀──── ─┘
                                                │
                                                │
   AgentNFT(C) ── Marketplace(C) ◀── acquire page(F)
                       │
                       ▼
                  TEE oracle(B)


   subscriber app(F) ── pay-with-any-token ── x402 gateway(B) ── 0G Compute(B) ── attestation
                              │                       │              │
                              ▼                       ▼              ▼
                          Uniswap(B)          authorizeUsage(C)   0G Log(B)


   ENS gateway worker(B) ── StratumResolver(C) ── ens.eth on L1
                  │
                  └── reads from indexer(B) for ENSIP-25 records
```

Critical path: **AgentNFT → Fractionalizer → operator wizard → mint → subscribe → infer.**
If this critical path isn't standing by hour 12, **scope-cut immediately**.

## 5. What can run in parallel from hour 0

- Frontend scaffold + base pages (no contracts needed; all mocked)
- AXL daemons + MCP server skeleton (no contracts needed)
- ENS resolver contract (independent)
- LoRA training (independent compute)

Almost everything can start in parallel. The only true serial dependency is "frontend wires to deployed contracts," which is hour 8+.

## 6. Daily standup format (3-min max)

Each person says:
- What I shipped since last standup
- What I'm shipping next
- What I'm blocked on (one line)
- Confidence on demo arc (1-5)

If anyone reports < 3 confidence, captain pulls them into a 5-min huddle to scope-cut.

## 7. Comms

- Discord/Telegram channel for the team
- One pinned message: "demo arc status" updated every 4 hours
- A `notes/` directory in the repo for raw notes
- `FEEDBACK.md` open in everyone's editor (collect notes as you go for Uniswap prize)

## 8. Tooling for the team

- Foundry + Anvil for contract dev (`forge test --watch`)
- 0G Galileo testnet RPC + faucet
- Base Sepolia RPC + faucet
- `bun` or `pnpm` for monorepo (turborepo if F can stomach it; otherwise plain workspaces)
- `viem` everywhere (not ethers — modern, type-safe)
- Cloudflare Worker for ENS gateway (5min deploy)
- Vercel for Next.js + Ponder indexer

## 9. Repo layout

```
stratum/
├── docs/                       # this directory
├── contracts/                  # Foundry
│   ├── src/
│   ├── test/
│   ├── script/
│   ├── deployments/
│   └── foundry.toml
├── apps/
│   ├── web/                    # Next.js frontend
│   ├── operator/               # Node.js operator node
│   ├── subscriber/             # CLI subscriber tool
│   ├── gateway/                # ENS Cloudflare Worker
│   └── indexer/                # Ponder
├── packages/
│   ├── sdk/                    # @stratum/sdk — wagmi hooks + viem helpers
│   ├── contracts-types/        # generated ABIs
│   └── shared/                 # types, constants
├── ml/
│   ├── train-lora/             # training script
│   ├── corpus/                 # encrypted corpus build
│   └── eval/                   # eval harness
├── scripts/
│   ├── deploy-stratum.sh       # one-shot deploy
│   ├── mint-hero-agent.sh
│   └── seed-demo-data.sh
├── README.md
├── FEEDBACK.md                 # for Uniswap prize
└── package.json (workspaces)
```

## 10. Definition of "done" (per workstream)

| Workstream | Done means |
|---|---|
| Contracts | All deployed to canonical testnet addrs, verified on explorer, tests passing |
| Backend | Operator node runs as `bun run operator`; subscriber CLI runs as `bun run subscriber:demo` |
| Frontend | Vercel-deployed, connects to deployed contracts, all 3 demo pages work end-to-end |
| ML | Hero agent encrypted blobs uploaded, system prompt frozen, demo contracts produce expected outputs |
| Submission | All sponsor checklists met (see 11-demo-and-submission.md) |

## 11. Definition of "shippable demo"

The demo arc must run **with zero edits** in 3 minutes:

1. Open marketplace home — show 1 agent listed.
2. Click `auditor` — show real revenue, real holders, real attestations.
3. Subscribe — pay 1 USDC in PEPE via Uniswap. Watch the swap+settle. Confirm `authorizeUsage` on-chain.
4. Run audit on `DemoVault.sol` — get structured output, attestation banner verified live.
5. Trigger weekly distribution — KeeperHub runs, watch shareholders' USDC balance update on Basescan.
6. Click "Acquire" — post a bid, accept it. Watch `iTransfer` event with TEE re-encryption attestation. Watch all 4 prior subscriber grants disappear.

If any step requires "let me explain..." or "in production this would..." we cut the step. The demo speaks for itself.
