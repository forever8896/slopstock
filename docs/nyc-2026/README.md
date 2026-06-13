# Slopstock @ ETHGlobal NYC 2026 — Continuity Track

> **Master index.** Every plan for the weekend lives in this folder. If it's not
> written here, it doesn't exist. This file is the orientation/thesis;
> **for live implementation status of every plan, see [MASTERPLAN.md](MASTERPLAN.md)** —
> the defensive status dashboard. Update it whenever a plan's status changes.

Event: ETHGlobal New York 2026, in-person. We enter the **first-ever Continuity
Track** — extending the Open Agents finalist (April 2026), not a from-scratch build.
Repo: github.com/forever8896/slopstock · local `/home/deepseek/open-agents` · branch `main`.

---

## The thesis (one sentence)

**Slopstock is where agentic commerce stops being a claim and becomes an auditable
balance sheet.** We strip the vaporware and token mechanics out of "AI agents" and
leave productive financial units whose every property is verifiable: identity
(ENS + ERC-8004), memory (Walrus), custody (policy-scoped wallets), and economics
(real USDC in, real compute cost out, net margin on screen).

Context worth citing on Sunday: ~81% of x402 *volume* is wash trading (Artemis).
Everyone else is the noise; we are the signal.

## The two goals that matter more than prizes

1. **Real revenue.** Even tiny — strangers paying our agents real USDC at the venue.
   "In April the agent economy was simulated. This weekend strangers' agents paid
   ours real money" + Basescan links is the closing slide.
2. **Answer "is agentic commerce in the room with us right now?"** via the
   **payment triangle** — every edge real, every edge on-chain:
   - **Inbound**: hackers pay AUDIT ($0.50 audits) / ORCL (price attestations).
   - **Outbound**: AUDIT pays Exa ($0.007/search); ORCL pays CoinGecko ($0.01) and
     resells at margin. (Both live-verified x402 v2 on Base mainnet.)
   - **Internal**: agent-to-agent payments + each agent self-funding its own
     compute (USDC→OG via LI.FI).

## Bounty stack (3 max, continuity-exclusive, one per partner)

| Bounty | Prize | Plan doc | Why it's on the critical path (not cosmetic) |
|---|---|---|---|
| **ENS** | $2.5k (2 winners) | [02-ens-erc8004.md](02-ens-erc8004.md) | Discovery is *how* the outbound leg finds counterparties; replaces an env-var registry |
| **Sui / Walrus** | $3k (4 winners) | [03-walrus.md](03-walrus.md) | Agent memory/portability — the missing half of "agents as transferable property" |
| **Dynamic** | $2k (Wallet Glow Up) + $2k (Agentic Build) | [04-dynamic.md](04-dynamic.md) | Mainnet money needs real custody; turns agents into governed economic units |

Dropped: Uniswap (sponsor-rapport reason). Everything else (Arc, World, Blink,
Unlink, LI.FI-Composer, Privy) is **surplus-time only** — see build order.

## Supporting workstreams (not bounties, but load-bearing for the goals)

- [05-x402-v2.md](05-x402-v2.md) — real x402 v2 spec, both directions (USER-MANDATED, no homegrown).
- [06-revenue-and-economics.md](06-revenue-and-economics.md) — mainnet rails, revenue split + P&L, self-funding loop, compute brain, GTM/selling.
- [01-network-switch.md](01-network-switch.md) — one-switch testnet↔mainnet config (built TDD-first).
- [07-build-order-checklist.md](07-build-order-checklist.md) — **the master sequenced checklist + stop-losses + timeline.**
- [00-state-and-funding.md](00-state-and-funding.md) — **live state, the funding blocker, every address & credential location.**

## Hard constraints / invariants (do not violate)

1. **IPO / fractional public share sale stays GATED on mainnet** (securities/Howey).
   The whole pipeline can run mainnet *as long as no stranger buys shares*. See
   [06-revenue-and-economics.md](06-revenue-and-economics.md) §Legal.
2. **Original 5 sponsors stay load-bearing** (0G, Uniswap, Gensyn, KeeperHub, ENS) —
   the "all non-cosmetic" moat must hold. 0G keeps chain + sealed-compute; Walrus
   takes storage (0G Storage was only ever a local-disk shadow anyway).
3. **TDD on everything, full stack.** No production code without a failing test
   first. See [01-network-switch.md](01-network-switch.md) and the TDD section in each plan.
4. **Testnet↔mainnet is one switch** (`NETWORK=testnet|mainnet`). No hand-edited
   addresses under demo pressure. Startup guard refuses to run if half-configured.

## Success criteria (what "done" looks like Sunday morning)

- [ ] Full payment triangle demonstrated on **mainnet** with real USDC + Basescan links.
- [ ] ≥1 payment from a wallet we don't control (a real stranger at the venue).
- [ ] ENS: `slopstock.eth` subnames resolve ENSIP-26 records on mainnet; ENSIP-25
      verification gates a real agent-to-agent payment; agents registered in ERC-8004.
- [ ] Walrus: amnesia demo (wipe operator data dir → agent restores memories from Walrus).
- [ ] Dynamic: 3-act guardrail demo (pay peer OK / over-limit blocked / treasury blocked).
- [ ] P&L on agent profile: gross revenue − compute COGS = net to vault, real numbers.
- [ ] Green test suite proving the end-to-end flow on testnet before mainnet flip.
