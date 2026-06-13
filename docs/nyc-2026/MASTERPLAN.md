# 🗺️ MASTERPLAN — Slopstock @ ETHGlobal NYC 2026

> **What this file is:** the single source of truth for *where every plan stands*.
> Work is sprawling across multiple workstreams (protocol, Hermes harness, web
> redesign, bounties, new agents) — this is the defensive index so **no plan gets
> forgotten**. Each row links the detailed plan doc and tracks its status + evidence.
>
> **How to use it:** before starting/resuming work, scan this file. **After any
> status change, update the row here** (and the linked doc). Consult master ⇄ plan
> docs to catch drift. If a plan exists only in someone's head, it's a bug — write it.
>
> Last reconciled: 2026-06-13 · test health: **61 pass / 0 fail** (`bun test packages/shared apps/operator`).

---

## North star (don't lose the thesis)

**Slopstock = where agentic commerce stops being a claim and becomes an auditable
balance sheet.** De-LARPed, genuinely useful, *payable* agents. Full thesis + goals
+ success criteria in [README.md](README.md). Two goals above prizes: **real revenue
from real strangers at the venue**, and proving **"is agentic commerce in the room"**
via the payment triangle (inbound ✅ / outbound ✅ / internal ✅ — all live on x402 v2).

Bounty stack (continuity-exclusive, 3): **ENS · Walrus · Dynamic**. Invariants
(never break): IPO public share-sale stays GATED on mainnet (securities); original 5
sponsors stay load-bearing; TDD on everything; one-switch network config.

## Status legend
✅ done & verified · 🟢 mostly done (verify tail) · 🟡 partial / in-flight · 🔲 not started · 📋 idea (needs doc)

---

## Plan registry

| # | Plan | Status | Evidence / what's done | What remains |
|---|---|---|---|---|
| 00 | [state-and-funding](00-state-and-funding.md) | 🟡 living | wallets, addresses, funding list, brain decision | mainnet funding still pending (deployer L1 ETH, agent mainnet USDC) |
| 01 | [network-switch](01-network-switch.md) | ✅ done | `network.ts` one-switch `NETWORK`, CAIP, ERC-8004 addrs pinned, 13 tests | migrate remaining call sites incrementally |
| 02 | [ens-erc8004](02-ens-erc8004.md) | 🔲 not started | registry addrs verified+pinned only | ENSIP-26 record writer, ERC-8004 register, resolve+verify, swap `query_agent` off env map, L2 reputation. **ENS bounty.** |
| 03 | [walrus](03-walrus.md) | 🟡 partial | `walrus-client.ts` built + testnet roundtrip proven; **skill storage/retrieval reliability VALIDATED** (`validate-walrus-skills.ts`: 12/12 stored, 36/36 reads byte-identical, 12/12 idempotent; write ~6.4s async / read ~364ms) | wire `WalrusStorage`→`OgStorageClient`, receipt pinning, snapshot/restore (async, post-task), AES encryption, amnesia demo. **Walrus bounty.** |
| 04 | [dynamic](04-dynamic.md) | 🔲 not started | recipe + 3-act demo speced | dashboard creds (Kilian), `importPrivateKey` AUDIT wallet, policies + webhook. **Dynamic bounty.** |
| 05 | [x402-v2](05-x402-v2.md) | ✅ done | all 3 legs real v2, verified live; homegrown deleted; smokes left | live mainnet Exa (needs ~$1 mainnet USDC) — optional |
| 06 | [revenue-and-economics](06-revenue-and-economics.md) | 🟡 partial | x402 settle works | revenue split + P&L, mainnet rails deploy (IPO gated), LI.FI self-funding top-up, **cost-display UX** (below), GTM/sell-at-venue |
| 07 | [build-order-checklist](07-build-order-checklist.md) | 🟡 living | the execution sequence + stop-losses | keep in sync as phases complete |
| 08 | [hermes-fidelity](08-hermes-fidelity.md) | 🟢 mostly done | commits `a1dd1eb`→`c8bde95`: skills.ts, memory-files.ts, progressive disclosure, skill_manage, Layer-1 memory, 5+tool trigger; tests green | verify all 8 tasks complete vs doc checklist; wire into Walrus amnesia demo |
| 09 | [agent-secrets](09-agent-secrets.md) | 🟢 decided | credential≠LLM-context principle; tiers x402-native → operator-env → 1Claw → TEE-sealed | Tier 1 (operator env) builds w/ drill-cypher; Tier 2 = **talk to Kevin/1Claw** at venue |
| 13 | [platform-split (web)](../13-platform-split-landing-docs.md) | 🟡 in-flight | daylight redesign, landing/app/docs split; commits + uncommitted `apps/web/*` | finish redesign; **read `deprecated` flag to hide legacy agents** |

## New plans — tracked, not yet written (📋 = needs its own spec doc)

| Plan | Status | Notes |
|---|---|---|
| **Demo-script agent** (first consumer agent) | 🟡 brainstorm | DECIDED: demo-script first; hybrid arch (deterministic repo-digest + `read_file` tool); brain = deepseek-v3 0G TEE (**tool-calling PROVEN** `smoke-0g-tool-calling.ts`; v4 = one-line swap, needs sub-account funding). Takes GitHub URL + optional "what bounties/vibe". Moat = our judging-criteria/marketing knowledge. **Next: finish brainstorm → spec doc → writing-plans.** Sibling agents: bounty-fit, submission-checker, integration-recipe. Customers = hackers in the room. |
| **Drill-cypher agent** (2nd consumer agent) | 🟡 brainstorm | Fun/viral: writes a drill cypher roasting your "opps" → **ElevenLabs Music v2** (one API call: lyrics→full rap track, vocals on beat, commercially cleared — kills beat-sourcing/TTS-align) → store on **Walrus** (media bounty synergy). Brain edgy/profane latitude PROVEN (`smoke-0g-tone-test.ts`). Moat = drill lyric craft. Needs: ElevenLabs key (Tier-1 secret, [09](09-agent-secrets.md)); validate audio quality with ONE real gen before committing. |
| **Agent-economics cost-display UX** | 📋 idea | Builder-platform feature: show deployer the per-call OG inference cost (real ledger numbers) so they price above COGS; "cost per X tokens" in launch UI. Backed by LI.FI top-up loop. Part of [06](06-revenue-and-economics.md). |
| **Legacy-agent deprecation** | 🟡 partial | `deprecated:true` set on AUDIT/MEMER/ORCL in `agent-metadata.ts`; the (in-flight) web UI must read the flag to hide/badge them. |

## Bounty → plan → status (the prize map)
- **ENS** $2.5k (continuity) → plan **02** → 🔲 (foundation only). Highest prize, our deepest fit.
- **Walrus** $3k (continuity, 4 winners) → plan **03** → 🟡 (client proven). Best odds.
- **Dynamic** $2k+$2k → plan **04** → 🔲 (needs dashboard). Smallest scope; sponsor rapport.

## Cross-cutting "do not forget" deliverables
- [ ] Mainnet revenue rails live (Base) + IPO gated — [06](06-revenue-and-economics.md)
- [ ] Revenue split + P&L on agent profile — [06](06-revenue-and-economics.md)
- [ ] Self-funding loop (LI.FI USDC→OG top-up) — [06](06-revenue-and-economics.md)
- [ ] Sell to hackers at venue (GTM) + revenue watcher — [06](06-revenue-and-economics.md)
- [ ] ENS records + ERC-8004 registration + reputation-weighted query_agent — [02](02-ens-erc8004.md)
- [ ] Walrus storage impl + amnesia demo — [03](03-walrus.md)
- [ ] Dynamic wallet glow-up + guardrail demo — [04](04-dynamic.md)
- [ ] Demo-script agent shipped + sold — new spec
- [ ] Architecture diagram (serves all 3 bounty submissions) — [07](07-build-order-checklist.md)
- [ ] ENS booth Sunday AM (mandatory, in person)

## Workstreams (who/what is moving in parallel)
- **Protocol layer** (Claude): network switch ✅, x402 v2 ✅, walrus client 🟡 — building bounty integrations next.
- **Hermes harness** (Kilian/agents): real-Hermes fidelity 🟢 — see [08](08-hermes-fidelity.md).
- **Web redesign** (Kilian): platform split / daylight 🟡 — [13](../13-platform-split-landing-docs.md). Claude stays out of `apps/web/*` to avoid collision unless asked.

## Maintenance rule
This file is only useful if it's true. **When you finish or start a plan item, update its
row + status here in the same commit.** Memory mirror: [[slopstock-nyc-buildplan]].
