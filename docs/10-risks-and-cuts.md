# 10 — Risks & Cuts

## 1. Risk register

Scored as **L** (likelihood, 1-5) and **I** (impact, 1-5). Score = L × I. Anything ≥ 12 needs an explicit mitigation owner.

| # | Risk | L | I | Score | Owner | Mitigation |
|---|---|---|---|---|---|---|
| R1 | 0G Compute Sealed Executor not exposed to hackathon devs at demo time | 3 | 5 | **15** | Captain | Confirm Hour 0 at sponsor booth. If unavailable: degrade to `qwen2.5-coder` non-sealed on 0G Compute, label demo flow "Sealed Executor TBD" |
| R2 | ERC-7857 reference impl doesn't deploy cleanly to 0G Galileo | 2 | 5 | 10 | C | Use the deployed singleton if 0G provides one; else port to a forked impl with mock TEE oracle |
| R3 | KeeperHub MCP can't read from Base Sepolia | 2 | 4 | 8 | B | Deploy RevenueVault on 0G Chain instead; lose "real x402 on Base" honesty for demo |
| R4 | AXL bootstrap peer unreachable from venue WiFi | 3 | 4 | **12** | B | Self-host bootstrap on $5 VPS w/ static IP; have backup peer in config |
| R5 | Uniswap pay-with-any-token skill not callable from non-Claude-Code context | 3 | 3 | 9 | B | Replicate logic with Universal Router multicall; or run pay-with-any-token from a Claude Code subprocess (hack but acceptable) |
| R6 | LoRA training fails or is bad quality | 3 | 3 | 9 | M | Use base model + heavy system prompt + RAG; pre-record fallback audit run for video |
| R7 | TEE re-encryption oracle on iTransfer is mocked | 3 | 4 | **12** | C | Acceptable for hackathon if labeled clearly; Plan: write a clean mock oracle service + on-chain mock verifier; document as "demo oracle" |
| R8 | x402 facilitator on Base Sepolia is flaky | 3 | 3 | 9 | B | Use Coinbase facilitator (most stable); fallback to direct USDC transfer with a 1-tx demo path |
| R9 | Cross-chain (0G Chain ↔ Base) coordination too complex for 36h | 3 | 4 | **12** | C+B | Decision rule: if any cross-chain integration takes > 4h, collapse to single-chain (everything on 0G Chain) |
| R10 | Frontend wallet UX flaky with multi-chain switching | 3 | 3 | 9 | F | Test with 5+ wallets early; default chain switch on button click; clear error states |
| R11 | Demo machine internet drops mid-presentation | 2 | 5 | 10 | Captain | Pre-recorded 3-min video as primary submission; live demo is bonus |
| R12 | Vercel deploy fails close to deadline | 2 | 4 | 8 | F | Deploy at hour 24 not hour 47; Vercel preview for every PR |
| R13 | ENS Sepolia name we want is squatted | 2 | 3 | 6 | Captain | Buy at hour 0; have 3 name alternatives ready |
| R14 | TEE attestation verification client doesn't work in browser | 2 | 4 | 8 | F | Verify server-side in our backend if browser-side fails; show banner with the result |
| R15 | Code4rena dataset license unclear | 1 | 3 | 3 | M | Use only public report content; cite all sources; fallback to SCSVS/SWC public docs |
| R16 | Indexer (Ponder) lags / missing data at demo time | 3 | 2 | 6 | B | Direct on-chain reads as fallback; pre-warm cache |
| R17 | Team member sick / no-show | 2 | 4 | 8 | Captain | Plan written so each workstream has a "minimum solo viable" path |
| R18 | Sponsors push back on "this is just NFTs + ERC20s" framing | 2 | 4 | 8 | Captain | Pitch deck explicitly explains: 7857 is NOT ERC-721, sealing is real, atomic re-encrypt is the trick |
| R19 | Demo too long, judges miss the punchline | 2 | 4 | 8 | Captain | Pre-rehearse 3min cut, 1min cut, 30s elevator |
| R20 | We hit a security bug during build | 1 | 5 | 5 | All | All code labeled "unaudited demo"; do not solicit real funds at any point |

**Top-3 risk-managed items (≥ 12):**
1. **R1** — 0G Sealed Executor availability — *must confirm Hour 0*
2. **R4** — AXL bootstrap — *self-host as default*
3. **R7** — TEE re-encryption oracle — *write a clean labeled mock*
4. **R9** — Cross-chain complexity — *collapse to single chain at 4h cutoff*

## 2. Cut order (the "kill list")

If we are behind schedule, cuts happen in this order. **Each cut is reversible if we get back on track**, but never spend > 30min undoing a cut.

| # | Cut | Loses | Saves | Triggered when |
|---|---|---|---|---|
| 1 | Second hero agent (`alpha`) | "Marketplace with multiple listings" demo moment | 4-6h | hour 24 |
| 2 | Operator wizard UI → Foundry script + CLI | Polish; mint flow on the demo machine | 8-10h | hour 18 |
| 3 | Dividends page → Basescan link | "Beautiful claims UI" | 3h | hour 28 |
| 4 | KeeperHub-managed distribution → manual `distribute()` from frontend admin button | KeeperHub prize gets weaker pitch | 4h | hour 14 (decide early) |
| 5 | Cross-chain RevenueVault on Base → on 0G Chain | Some honesty about x402-on-Base | 3-5h | hour 12 |
| 6 | Real LoRA → base model + RAG only | Some demo oomph | 4h | hour 18 |
| 7 | Real TEE attestation → mocked + labeled | Cryptographic strength of demo | 6h | hour 20 (only if R1 fires) |
| 8 | Buy/IPO page → CLI demo | Live "buy shares" moment | 4h | hour 30 |
| 9 | Ponder indexer → direct chain reads (slower UI) | Snappy UX | 4h | hour 24 |
| 10 | Multi-chain wallet switching → single-chain demo | Some ENS prize coverage (since L1 is needed for ENS) | 2h | hour 32 |

**Floor (never cut):**
- Mint + Fractionalize + Subscribe + Infer + Acquire
- One real attested inference call
- Live `iTransfer` with re-encryption (real or labeled-mock)
- The 3-min demo video

If any of those falls below "demoable," the project has failed. Pivot to writing it up as a research artifact and submit anyway.

## 3. Decision-time gates

Pre-set decisions to make at fixed times. Avoid decision-by-fatigue.

| Gate | Time | Decision | Default if undecided |
|---|---|---|---|
| **Sealed Executor go/no-go** | hour 0 | TEE | ZKP | mock | TEE |
| **Cross-chain go/no-go** | hour 4 | Base+0G | 0G-only | 0G-only |
| **Hero agent fine-tune?** | hour 6 | Train LoRA | base+RAG only | base+RAG only |
| **Vertical slice working?** | hour 12 | YES → continue | NO → invoke cut #1, #2 immediately | invoke cuts |
| **Sealed transfer real?** | hour 18 | real TEE oracle | labeled mock | labeled mock |
| **Demo dry-run goes well?** | hour 30 | YES → polish | NO → cut more, simplify demo arc | cut |
| **Final submission ready?** | hour 38 | YES → submit | NO → submit anyway with what's working | submit |

## 4. The "we still have a project" floor

If everything goes wrong, the **minimum publishable artifact** is:

- `AgentNFT` (forked 7857) deployed
- `ShareToken` deployed
- `Fractionalizer` deployed and working
- A working `mint → fractionalize → buy shares → subscribe → unsealed inference → distribute manually` flow
- Frontend: marketplace home + agent detail + subscribe page

That's a worse demo, but it's still a demo, and we've still validated the idea.

**Even worse-case:** if the chain stuff totally breaks, ship the **architecture** as an open-spec proposal — `docs/` directory + a working operator node + a demo of the inference + attestation flow without on-chain settlement. We frame as "proposed primitive for agent capital markets" rather than "deployed product."

## 5. The "things that look risky but actually aren't" list

(Useful to keep team morale up.)

| Looks risky | Actually fine |
|---|---|
| Solidity bugs | Foundry + careful tests; we don't custody real money |
| AXL learning curve | Docs are good; "talks to localhost" abstraction is real |
| 0G learning curve | Reference impl is published; OpenAI-compatible API |
| Multi-wallet UX | wagmi handles it; tested pattern |
| LoRA training | Optional — base model + RAG works |
| Vercel deploy | Boring, well-trodden path |
| GitHub repo readability | We have time for README polish |

## 6. Sponsor-specific risks

| Sponsor | Risk | Mitigation |
|---|---|---|
| 0G | Sealed Executor unavailable | Mock + label, but lose iNFT track strength |
| Uniswap | pay-with-any-token integration shallow | Use it in 2 places (subscribe + acquisition payment) for depth |
| Gensyn | Mesh just hub-and-spoke | Add a 3rd node ("watcher") to prove mesh |
| KeeperHub | Workflow doesn't fire on time | Manual trigger button as fallback; KH still in pitch |
| ENS | "Cosmetic" judging risk | Implement all 4 uses (ticker, registry, rotating, subnames-as-keys) so depth is undeniable |

## 7. Post-mortem checklist (write at hour 40)

For our own learning + the FEEDBACK.md submission:

- What worked: ___
- What didn't: ___
- What I'd do differently: ___
- Per sponsor:
  - Easiest integration: ___
  - Hardest integration: ___
  - Best DX moment: ___
  - Worst DX moment: ___
  - Feature requests: ___

## 8. Anti-pattern alarm list

Things that, if we catch ourselves doing, mean we're off-track:

- "Let's just make this fancy first" — nope, finish vertical slice
- "This won't work, let's swap stacks" past hour 12 — no, cut features instead
- "Let me refactor this" past hour 24 — no
- "Maybe we should also build X" past hour 18 — no
- "We have time, let's add a chart" past hour 36 — no
- "Just one more contract" past hour 30 — no
- "We can deploy at hour 47" — no, deploy by hour 30 then iterate

The captain's job is to pattern-match these and shut them down.
