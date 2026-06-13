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
> Last reconciled: 2026-06-13 · test health: **137 pass / 0 fail** (`bun test packages/shared apps/operator`).

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
| 02 | [ens-erc8004](02-ens-erc8004.md) | 🟡 code done (funding-gated) | **funding-independent code landed** (commit `8215bb7`, +56 tests): ERC-7930 interop-address encoder (`packages/shared/src/erc7930.ts`, round-trip verified — the plan's hand-crafted example was suspect, this is the source of truth); ENS records writer (`setTextRecords`/`readTextRecord`, network-configurable, Sepolia-tested); `resolveAgent`/`verifyAgent` (ENSIP-25 fail-on-empty, both branches tested); `query_agent` now ENS-first w/ ENSIP-25 verify before paying, `BASE_SEPOLIA_AGENTS` kept as fallback only | **blocked on L1 ETH** (deployer `0x2908…9D10`): fire `setTextRecords({network:"mainnet",…})` per agent + ERC-8004 `register(agentURI)`/`setAgentWallet` once funded (entrypoints ready); then `NETWORK=mainnet`. L2 reputation still ahead. **ENS bounty.** |
| 03 | [walrus](03-walrus.md) | 🟢 mostly done | client + skill reliability VALIDATED; **all 4 plan layers built & tested** (commit `1b6b483`, +18 tests, real testnet blobIds): `WalrusStorage implements OgStorageClient` behind `STORAGE_BACKEND=walrus\|shadow` switch; AES-256-GCM envelope (`crypto.ts`, wrong-key fails); snapshot/restore w/ Hermes hooks (tar→encrypt→Walrus→wipe→restore byte-identical incl. `memory.db`); receipt pinning (blobId in receipt index, `walrusTapeUrl()`) | web inference tape to read aggregator URL (`apps/web/*` — Kilian); set `AGENT_SNAPSHOT_KEY` in operator env + do the live amnesia-demo run; note testnet `epochs=90` broken on all 3 publishers → default `epochs=5` (`WALRUS_EPOCHS`). **Walrus bounty.** |
| 04 | [dynamic](04-dynamic.md) | 🟡 unblocked | recipe + 3-act demo speced; **`dyn` CLI authed** (project KilianSolutions, sandbox env `f8788caa…`) → the "dashboard" creds are CLI-reachable, NOT human-blocked: `environments list-keys` = `DYNAMIC_AUTH_TOKEN`, env id = `DYNAMIC_ENVIRONMENT_ID`, `update-settings --chains` enables Base, `providers` enables embedded wallets | pull env-id + API key into `.env` (CLI), enable Base, choose `WALLET_PASSWORD`; then SDK build steps: LocalAccount wrapper, `importPrivateKey` AUDIT wallet, policies + webhook. **Dynamic bounty.** |
| 05 | [x402-v2](05-x402-v2.md) | ✅ done | all 3 legs real v2, verified live; homegrown deleted; smokes left | live mainnet Exa (needs ~$1 mainnet USDC) — optional |
| 06 | [revenue-and-economics](06-revenue-and-economics.md) | 🟡 partial | x402 settle works | revenue split + P&L, mainnet rails deploy (IPO gated), LI.FI self-funding top-up, **cost-display UX** (below), GTM/sell-at-venue |
| 07 | [build-order-checklist](07-build-order-checklist.md) | 🟡 living | the execution sequence + stop-losses | keep in sync as phases complete |
| 08 | [hermes-fidelity](08-hermes-fidelity.md) | ✅ done | all 9 plan tasks + 3 review fixes, commits `a1dd1eb`→`006f4e3` (docs `94c90fc`): progressive disclosure (Level-0 index, **no body dump**), `skill_manage` create/edit/delete, slug-keyed upsert (**self-improves in place**), Layer-1 `MEMORY.md`/`USER.md`, 5+tool/error-recovery trigger, per-`runTask` skill+memory reload; **50/50 operator tests green**, final review SHIP-READY | live `smoke-hermes` on 0G brain (needs funding); wire `MEMORY.md` into Walrus amnesia demo ([03](03-walrus.md)) |
| 09 | [agent-secrets](09-agent-secrets.md) | 🟢 decided | credential≠LLM-context principle; tiers x402-native → operator-env → 1Claw → TEE-sealed | Tier 1 (operator env) builds w/ drill-cypher; Tier 2 = **talk to Kevin/1Claw** at venue |
| 13 | [platform-split (web)](../13-platform-split-landing-docs.md) | 🟡 in-flight | daylight redesign, landing/app/docs split; commits + uncommitted `apps/web/*` | finish redesign; **read `deprecated` flag to hide legacy agents** |

## New plans — tracked, not yet written (📋 = needs its own spec doc)

| Plan | Status | Notes |
|---|---|---|
| **[Demo-script agent](10-demo-script-agent.md)** (first consumer agent) | 🔲 spec'd (was brainstorm) | **Spec doc written + reworked 2026-06-13** ([10](10-demo-script-agent.md)) — hybrid arch (deterministic repo-digest + `read_file`), brain deepseek-v3 0G TEE (tool-calling proven; v4 = one-line swap). **Moat = our judging frame × LIVE [ethglobal-skills](https://github.com/ethglobal-skills/repo) data** (17,643 projects + sponsor bounties + every finalist/winner — free tier verified working 2026-06-13). ⚠️ their **paid x402 path is broken** (returns 500/`MIDDLEWARE_INVOCATION_FAILED`, not 402) → use as free-tier data source (cache, ≤10/min); payment-triangle headline stays with **Exa** (proven). $2.00/run vs ~$0.003 COGS. **Next: writing-plans → build.** Open Q: who authors the hand-curated frame + when (data half is now automated). Siblings (future): bounty-fit, submission-checker, integration-recipe. |
| **[Drill-cypher agent](11-drill-cypher-agent.md)** (2nd consumer agent) | 🔲 spec'd (gated) | **Spec doc written 2026-06-13** ([11](11-drill-cypher-agent.md)) — pipeline deepseek-v3 lyrics (tone latitude proven `smoke-0g-tone-test.ts`) → **ElevenLabs Music v2** (one API call) → **Walrus** (media bounty synergy), inline web audio player, $3.00/run. **Hard gate Step 0:** ONE real audio gen must prove the endpoint before any wiring. Needs ElevenLabs key (Tier-1, [09](09-agent-secrets.md)). Open Q: exact endpoint name + per-call cost (settle at de-risk gate by Sat 11 AM). |
| **Agent-economics cost-display UX** | 📋 idea | Builder-platform feature: show deployer the per-call OG inference cost (real ledger numbers) so they price above COGS; "cost per X tokens" in launch UI. Backed by LI.FI top-up loop. Part of [06](06-revenue-and-economics.md). |
| **Legacy-agent deprecation** | 🟡 partial | `deprecated:true` set on AUDIT/MEMER/ORCL in `agent-metadata.ts`; the (in-flight) web UI must read the flag to hide/badge them. |

## Bounty → plan → status (the prize map)
- **ENS** $2.5k (continuity) → plan **02** → 🟡 (resolver/verifier/writer + ERC-7930 all coded & tested; live writes gated on L1 ETH). Highest prize, our deepest fit.
- **Walrus** $3k (continuity, 4 winners) → plan **03** → 🟢 (all 4 layers built & tested; only web tape + live amnesia demo remain). Best odds.
- **Dynamic** $2k+$2k → plan **04** → 🟡 (unblocked — `dyn` CLI authed, sandbox env exists; needs config + SDK build). Smallest scope; sponsor rapport.

## Cross-cutting "do not forget" deliverables
- [ ] Mainnet revenue rails live (Base) + IPO gated — [06](06-revenue-and-economics.md)
- [ ] Revenue split + P&L on agent profile — [06](06-revenue-and-economics.md)
- [ ] Self-funding loop (LI.FI USDC→OG top-up) — [06](06-revenue-and-economics.md)
- [ ] Sell to hackers at venue (GTM) + revenue watcher — [06](06-revenue-and-economics.md)
- [ ] ENS records + ERC-8004 registration + reputation-weighted query_agent — [02](02-ens-erc8004.md) · *resolver/verifier/writer + ERC-7930 coded & tested; live writes gated on L1 ETH*
- [ ] Walrus storage impl + amnesia demo — [03](03-walrus.md) · *storage impl + AES + snapshot/restore + receipt pinning ✅; live amnesia-demo run + web tape remain*
- [ ] Dynamic wallet glow-up + guardrail demo — [04](04-dynamic.md)
- [ ] Demo-script agent shipped + sold — new spec
- [ ] Architecture diagram (serves all 3 bounty submissions) — [07](07-build-order-checklist.md)
- [ ] ENS booth Sunday AM (mandatory, in person)

## Workstreams (who/what is moving in parallel)
- **Protocol layer** (Claude): network switch ✅, x402 v2 ✅, Walrus 🟢 (all layers built+tested), ENS/8004 🟡 (code done, funding-gated) — bounty integrations landed this session via parallel worktree agents.
- **Hermes harness**: real-Hermes fidelity ✅ (Claude, this session) — see [08](08-hermes-fidelity.md). Only live smoke + Walrus-amnesia wiring remain.
- **Web redesign** (Kilian): platform split / daylight 🟡 — [13](../13-platform-split-landing-docs.md). Claude stays out of `apps/web/*` to avoid collision unless asked.

## Maintenance rule
This file is only useful if it's true. **When you finish or start a plan item, update its
row + status here in the same commit.** Memory mirror: [[slopstock-nyc-buildplan]].
