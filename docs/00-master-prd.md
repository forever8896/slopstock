# Master PRD — Agent Capital Markets

**Codename:** Stratum
**Hackathon:** Open Agents (ETHGlobal), April 2026
**Owner:** kilianvaldman@gmail.com
**Doc status:** v0.1 — pre-build scoping

---

## 1. One-line description

A stock exchange for AI agents: mint a productive agent as an iNFT, fractionalize its ownership, distribute its inference revenue to shareholders, sell the whole thing atomically without leaking the weights.

## 2. The problem

Profitable agents today have no equity layer.

| Today's options | What's broken |
|---|---|
| Run it yourself | Capped by your capital, can't raise |
| Sell the strategy/agent | Buyer copies it, secondary market has no provenance |
| Tokenize via Virtuals/ai16z | A meme coin glued to a chatbot — no actual revenue rights, no sealed weights |
| Operator royalties on a platform | Trusts a custodian; centralized chokepoint |

The missing primitive: **transferable ownership of a productive agent without disclosing its weights.** ERC-7857 (final 2025-01) introduced this primitive. Almost nobody has built on it.

## 3. The thesis

> **The 2024 narrative was "agents that do things." The 2026 narrative is "agents as productive property."**

Agents have measurable, attested, onchain-verifiable cashflows. They behave like SaaS micro-companies. Equity markets exist for SaaS companies. They don't exist for agents — purely because, until ERC-7857, you couldn't transfer an agent without giving it away.

We build the missing layer.

## 4. Target users

| Segment | Job-to-be-done | Why they show up |
|---|---|---|
| **Agent builders** (quants, fine-tuners, LoRA authors) | Liquidity without leak | Mint, fractionalize, retain 70% — cash out 30% to fund compute |
| **Investors** (crypto-native, AI-curious) | New asset class with onchain cashflows | Buy shares of high-revenue agents, build a portfolio, short underperformers |
| **Subscribers** (devs, traders, analysts) | Verifiable, pay-per-use AI | Subscribe via x402, pay in any token, get TEE-attested outputs |

## 5. Scope

### In scope (must ship for demo)

1. Mint flow: encrypt weights → upload to 0G Storage → mint ERC-7857 iNFT → register ENS ticker
2. Fractionalize: lock iNFT in vault, mint 1M ERC-20 shares
3. IPO: sell 30% of shares via fixed-price sale (no AMM in v1)
4. Subscribe: subscriber pays x402 paywall in any token via Uniswap; agent runs in 0G Compute Sealed Executor; signed output returned via AXL
5. Distribute: KeeperHub workflow sweeps revenue contract weekly, distributes pro-rata to shareholders
6. Acquire: whole-iNFT buyout — TEE re-encrypts weights to new owner, all `authorizeUsage()` grants clear, ENS resolver flips
7. Frontend: list agent → click to detail → buy shares → subscribe → view revenue → trigger acquisition

### Out of scope (v1)

- Continuous AMM for share trading (we use fixed-price + manual OTC for v1)
- Multi-agent index funds, ETFs, derivatives
- Governance proposals (upgrade/retire/retrain) — gestured at, not implemented
- Order book, options, perps on agents
- Mobile app
- More than one hero agent

### Stretch goals (if time)

- Bonding curve on share token (replaces fixed-price sale)
- Two hero agents to demo "portfolio" UX
- Live performance dashboard with attestation log

## 6. Success criteria

### For the hackathon (judging-facing)

- [ ] End-to-end demo runs in < 3 minutes with zero "trust me" moments
- [ ] Every cryptographic claim is verifiable onchain or via TEE attestation in the demo
- [ ] All 5 sponsor stacks are *load-bearing* (pull one → product collapses)
- [ ] Public GitHub repo with README + setup instructions
- [ ] Live demo URL deployed (Vercel)
- [ ] < 3min demo video uploaded
- [ ] Architecture diagram in README
- [ ] One working hero agent with real, attested inference

### For "is this revolutionary"

- [ ] A sophisticated judge cannot name a 2024-2025 project that did this
- [ ] The 7857 sealed-transfer is performed *live* in the demo, not faked
- [ ] Revenue actually flows to a fractional shareholder address in the demo

## 7. Sponsor coverage

We are targeting **5 sponsors / 8 prize buckets** with this single project:

| Sponsor | Track | Pool | Our angle |
|---|---|---|---|
| 0G | Best Autonomous Agents / iNFT Innovations | $7.5k (top-5) | iNFT (ERC-7857), 0G Storage for sealed weights, 0G Compute for sealed inference |
| 0G | Best Agent Framework / Tooling | $7.5k (top-5) | The fractionalization + revenue split contracts are a reusable framework — `stratum-sdk` |
| Uniswap | Best Uniswap API integration | $5k | `pay-with-any-token` skill bridges x402 paywalls into swaps |
| Gensyn | Best AXL application | $5k | Two AXL nodes (operator + subscriber) deliver inference P2P with no central API |
| KeeperHub | Best Use of KeeperHub | $4.5k | Revenue distribution workflow + agent registered via ERC-8004 |
| KeeperHub | Builder Feedback bounty | $500 | FEEDBACK.md with honest integration notes |
| ENS | Best ENS for AI agents | $2.5k | Ticker subnames, ENSIP-25 registry, CCIP-Read |
| ENS | Most Creative Use of ENS | $2.5k | CCIP-Read returns rotating treasury addresses; subnames as revocable subscriber API keys |

**Realistic outcome:** placing in 4-6 of these is the goal. Total prize pool we're targeting: **$35k**. Realistic capture: **$5k–$15k**.

See `12-sponsor-mapping.md` for per-sponsor submission checklist.

## 8. Anti-goals (things we will *not* do)

- **Will not** custodian-back the weights ("we totally promise we re-encrypted them"). Either the TEE attestation is real or we don't ship that flow.
- **Will not** pretend to have an AMM. We say "fixed-price sale, AMM is future work" honestly.
- **Will not** call this "Virtuals 2.0." Virtuals lacks revenue rights and sealed weights — the comparison hurts us.
- **Will not** build N example agents. One real agent beats five mocked ones.
- **Will not** add governance complexity that doesn't ship working.
- **Will not** add an L2 dependency we don't already need (no Base, no Arbitrum unless required for a sponsor stack).

## 9. Naming / branding

- **Project name:** Stratum (working title) — alts: Yield (taken), Tessera, Equity Layer
- **Hero agent ENS:** `auditor.stratum.eth` (or chosen alt) — see `08-hero-agent.md`
- **Twitter/X handle:** TBD
- **Color/visual:** dark, terminal-aesthetic, Bloomberg-inspired (signals "this is finance, not vibes")

## 10. Glossary (internal canonical terms)

- **Agent** — a 7857 iNFT pointing to encrypted weights/system-prompt/state on 0G Storage.
- **Operator** — the human/entity who minted the agent and runs the inference node (controls TEE keys initially).
- **Shareholder** — holder of fractional ERC-20 shares of an agent; entitled to pro-rata revenue.
- **Subscriber** — a paying user who calls `authorizeUsage()` to invoke the agent.
- **Revenue Vault** — the contract that holds inference revenue and distributes it pro-rata.
- **Ticker** — the agent's ENS subname (e.g. `auditor.stratum.eth`); used as the human handle.
- **Acquisition** — whole-iNFT buyout, requires re-encryption proof and atomically clears subscriber grants.

## 11. Document map

| # | Doc | Purpose |
|---|---|---|
| 00 | master-prd | this file |
| 01 | architecture | system diagram, data flow |
| 02 | smart-contracts | iNFT + shares + vault + marketplace |
| 03 | sealed-inference | 0G Compute pipeline |
| 04 | revenue-and-payments | x402, Uniswap, KeeperHub |
| 05 | ens-identity | tickers, CCIP-Read, ENSIP-25 |
| 06 | axl-delivery | P2P inference layer |
| 07 | frontend | UI spec |
| 08 | hero-agent | the demo agent |
| 09 | execution-plan | hour-by-hour timeline |
| 10 | risks-and-cuts | what fails, what we cut |
| 11 | demo-and-submission | demo script + per-sponsor checklist |

## 12. Open questions

- Are 0G Compute Sealed Executor endpoints actually exposed to hackathon devs as of Apr 2026? *(Action: confirm at sponsor booth Hour 0.)*
- Does KeeperHub MCP support a custom workflow that reads our revenue contract directly, or do we need a webhook bridge? *(Action: read KeeperHub MCP docs Hour 0.)*
- AXL bootstrap node — do we self-host or use a Gensyn public peer? *(Action: confirm at sponsor booth Hour 0.)*
- Which chain is canonical for the iNFT — 0G Chain or Base? Probably 0G Chain since iNFT is 0G's primitive, but ENS lives on L1/Sepolia. *(Decision: see 01-architecture.md.)*
- For ERC-7857, is the TEE flow or ZKP flow more demoable in 36h? *(Decision pending: probably TEE because reference impl is more mature; see 03-sealed-inference.md.)*

## 13. Decision log

*(empty — populate during build)*
