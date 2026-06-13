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
> Last reconciled: 2026-06-13 · test health on `main`: **137 pass / 0 fail** (`bun test packages/shared apps/operator`).
> ⏳ **+42 tests pending merge**: demo-script agent (plan 10) is built & green in worktree `agent-ab1bc465…` (commit `bbb948b`), not yet on `main` — blocked only by an uncommitted local edit to `packages/shared/src/index.ts`. Merging lands 179 pass / 6 skip.
>
> 🟢 **Session 2026-06-13 (cont.) — three milestones (commits `2d79133`, `8ec2ce3`, `3cc0b48`):**
> (1) **ENS bounty LIVE on mainnet** — `auditor.slopstock.eth` (#55228) + `oracles.slopstock.eth` (#55229), ENSIP-26 + ERC-8004 + ENSIP-25, plus a real ENS-discovered + ENSIP-25-verified a2a x402 payment (settle `0x22dc388…`). The "L1 funding blocker" was stale (gas ~0.12 gwei → whole publish <$0.01).
> (2) **0G deepseek-v4-flash brain funded + verified on mainnet** via a real **LI.FI** L1-ETH→0G-OG bridge (plan-06 self-funding leg now shipped). Hermes verified on it (sealed TEE).
> (3) **Full agentic-commerce loop proven GREEN** — launch → x402 pay → sealed v4 infer → signed receipt → vault → snap → shareholder paid pro-rata.

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
| 00 | [state-and-funding](00-state-and-funding.md) | 🟡 living | wallets, addresses, funding list, brain decision; **0G compute funded on mainnet via LI.FI bridge (L1 ETH→OG), v4-flash sub-account live + verified; ENS L1 writes done (gas ~0.12 gwei = non-issue)** | mainnet **Base** rails USDC for live revenue-from-strangers still pending; v3 sub-account 5.83 OG in 24h refund-lock → reclaim via `processRefund` |
| 01 | [network-switch](01-network-switch.md) | ✅ done | `network.ts` one-switch `NETWORK`, CAIP, ERC-8004 addrs pinned, 13 tests | migrate remaining call sites incrementally |
| 02 | [ens-erc8004](02-ens-erc8004.md) | ✅ **LIVE on mainnet** | **All 5 acceptance criteria met on ETH mainnet + Base mainnet (commits `8ec2ce3`, `3cc0b48`):** `auditor.slopstock.eth` (ERC-8004 #55228) + `oracles.slopstock.eth` (#55229) carry ENSIP-26 (`agent-context`, `agent-endpoint[x402\|web]`, `addr`) + ENSIP-25 (`agent-registration[…]="1"`); resolvable in any client; `verifyAgent` passes for the real id and **rejects forgery**; **real ENS-discovered, ENSIP-25-verified a2a x402 payment** (`ens-a2a-pay.ts`, settle `0x22dc388…`, peer returned live ETH/USD + signed receipt). ERC-7930 encoder is source of truth. Scripts: `ens-mainnet-publish.ts`, `erc8004-register.ts`, `ens-a2a-pay.ts`. Code base from `8215bb7` (+56 tests). | L2 reputation-weighted `query_agent` (`getSummary`) optional upside; ENS booth Sun AM (in person). **ENS bounty — DONE.** |
| 03 | [walrus](03-walrus.md) | 🟢 mostly done | client + skill reliability VALIDATED; **all 4 plan layers built & tested** (commit `1b6b483`, +18 tests, real testnet blobIds): `WalrusStorage implements OgStorageClient` behind `STORAGE_BACKEND=walrus\|shadow` switch; AES-256-GCM envelope (`crypto.ts`, wrong-key fails); snapshot/restore w/ Hermes hooks (tar→encrypt→Walrus→wipe→restore byte-identical incl. `memory.db`); receipt pinning (blobId in receipt index, `walrusTapeUrl()`) | web inference tape to read aggregator URL (`apps/web/*` — Kilian); set `AGENT_SNAPSHOT_KEY` in operator env + do the live amnesia-demo run; note testnet `epochs=90` broken on all 3 publishers → default `epochs=5` (`WALRUS_EPOCHS`). **Walrus bounty.** |
| 04 | [dynamic](04-dynamic.md) | 🟡 creds wired, build next | recipe + 3-act demo speced; `dyn` CLI authed (project KilianSolutions). **Creds now in `.env` (2026-06-13):** `DYNAMIC_ENVIRONMENT_ID=f8788caa…` (sandbox), `DYNAMIC_AUTH_TOKEN` (token `e9c0009a…`, scopes `waas.authenticate`+`environment.balances.read`, minted via `dyn tokens create-post`), `WALLET_PASSWORD` (generated). `.env` gitignored; orphan dup token revoked. ⚠️ token value appeared in a tool transcript — rotate via `dyn tokens delete e9c0009a…` if treating transcript as untrusted | SDK build steps (TDD, on Base Sepolia first): `@dynamic-labs-wallet/node-evm` LocalAccount wrapper (`enableMPCAccelerator:false`), `importPrivateKey` AUDIT wallet, policies REST + violation webhook. Base-enable likely unneeded (MPC signing is chainId-agnostic; we self-broadcast). **Dynamic bounty.** |
| 05 | [x402-v2](05-x402-v2.md) | ✅ done | all 3 legs real v2, verified live; homegrown deleted; smokes left | live mainnet Exa (needs ~$1 mainnet USDC) — optional |
| 06 | [revenue-and-economics](06-revenue-and-economics.md) | 🟡 partial (big progress) | x402 settle works; **LI.FI self-funding leg SHIPPED** (`bridge-lifi-to-0g.ts`: L1 ETH→0G OG via gasZipBridge, proven 0.002 ETH→10.78 OG); **revenue claim proven GREEN end-to-end** (`smoke-e2e-full-loop.ts`: launch→pay→sealed v4 infer→signed receipt→vault→snap→shareholder paid pro-rata, Base Sepolia rails + 0G mainnet brain); **`finance-deploy` rebound to Circle USDC (EIP-3009)** so x402-settled revenue is countable (was stranded on plain-ERC20 TestnetUSDC) | revenue split + P&L UI, mainnet **Base** rails deploy (IPO gated), cost-display UX, GTM/sell-at-venue, auto revenue-watcher top-up trigger |
| 07 | [build-order-checklist](07-build-order-checklist.md) | 🟡 living | the execution sequence + stop-losses | keep in sync as phases complete |
| 08 | [hermes-fidelity](08-hermes-fidelity.md) | ✅ done | all 9 plan tasks + 3 review fixes, commits `a1dd1eb`→`006f4e3` (docs `94c90fc`): progressive disclosure (Level-0 index, **no body dump**), `skill_manage` create/edit/delete, slug-keyed upsert (**self-improves in place**), Layer-1 `MEMORY.md`/`USER.md`, 5+tool/error-recovery trigger, per-`runTask` skill+memory reload; **50/50 operator tests green**, final review SHIP-READY; **verified live on 0G mainnet deepseek-v4-flash** (`smoke-hermes SMOKE_BACKEND=0g-compute`: skills + tools + frozen memory + sealed TEE attestation, correct audit output) | wire `MEMORY.md` into Walrus amnesia demo ([03](03-walrus.md)) |
| 09 | [agent-secrets](09-agent-secrets.md) | 🟢 decided | credential≠LLM-context principle; tiers x402-native → operator-env → 1Claw → TEE-sealed | Tier 1 (operator env) builds w/ drill-cypher; Tier 2 = **talk to Kevin/1Claw** at venue |
| 13 | [platform-split (web)](../13-platform-split-landing-docs.md) | 🟡 in-flight | daylight redesign, landing/app/docs split; commits + uncommitted `apps/web/*` | finish redesign; **read `deprecated` flag to hide legacy agents** |

## New plans — tracked, not yet written (📋 = needs its own spec doc)

| Plan | Status | Notes |
|---|---|---|
| **[Demo-script agent](10-demo-script-agent.md)** (first consumer agent) | 🟡 BUILT, pending merge | **Steps 1–4 built & green (commit `bbb948b`, +42 tests, in worktree `agent-ab1bc465…`, NOT yet on `main`):** `repo-digest.ts`, `read_file` tool, `ethglobal-skills.ts` (free-tier data tools, soft-fail), 0G inference loop (`run.ts`, 5-round cap), `POST /run/demo-script` x402-gated $2.00 + receipt. Step 5 (web UI) skipped (Kilian). **Moat = our judging frame × LIVE [ethglobal-skills](https://github.com/ethglobal-skills/repo) data** (17,643 projects + bounties + winners — free tier works). ⚠️ their **paid x402 path is broken** (500/`MIDDLEWARE_INVOCATION_FAILED` not 402) — confirmed via **`agentcash fetch` AND raw curl** 2026-06-13; treat as free-tier source only, payment-triangle headline stays with **Exa**. **Remaining:** merge to `main` (blocked by uncommitted local `index.ts` edit); human authors the judging-frame stub (`packages/shared/src/agents/demo-script/system-prompt.ts` — currently a TODO placeholder, no fabricated criteria); wire Walrus receipt-pinning; set `DEMO_SCRIPT_VAULT_ADDRESS`; web card. |
| **[Drill-cypher agent](11-drill-cypher-agent.md)** (2nd consumer agent) | 🔲 spec'd (gated) | **Spec doc written 2026-06-13** ([11](11-drill-cypher-agent.md)) — pipeline deepseek-v3 lyrics (tone latitude proven `smoke-0g-tone-test.ts`) → **ElevenLabs Music v2** (one API call) → **Walrus** (media bounty synergy), inline web audio player, $3.00/run. **Hard gate Step 0:** ONE real audio gen must prove the endpoint before any wiring. Needs ElevenLabs key (Tier-1, [09](09-agent-secrets.md)). Open Q: exact endpoint name + per-call cost (settle at de-risk gate by Sat 11 AM). |
| **Agent-economics cost-display UX** | 📋 idea | Builder-platform feature: show deployer the per-call OG inference cost (real ledger numbers) so they price above COGS; "cost per X tokens" in launch UI. Backed by LI.FI top-up loop. Part of [06](06-revenue-and-economics.md). |
| **Legacy-agent deprecation** | 🟡 partial | `deprecated:true` set on AUDIT/MEMER/ORCL in `agent-metadata.ts`; the (in-flight) web UI must read the flag to hide/badge them. |

## Bounty → plan → status (the prize map)
- **ENS** $2.5k (continuity) → plan **02** → ✅ **LIVE on mainnet** (ENSIP-26 + ERC-8004 #55228/#55229 + ENSIP-25 verify + real ENS-discovered a2a payment). Highest prize, our deepest fit — **DONE**; reputation-weighting (L2) is optional upside.
- **Walrus** $3k (continuity, 4 winners) → plan **03** → 🟢 (all 4 layers built & tested; only web tape + live amnesia demo remain). Best odds.
- **Dynamic** $2k+$2k → plan **04** → 🟡 (creds wired to `.env` via `dyn` CLI; SDK build next). Smallest scope; sponsor rapport.

## Cross-cutting "do not forget" deliverables
- [ ] Mainnet revenue rails live (Base) + IPO gated — [06](06-revenue-and-economics.md)
- [ ] Revenue split + P&L on agent profile — [06](06-revenue-and-economics.md)
- [x] Self-funding loop (LI.FI L1 ETH→0G OG bridge) — shipped `bridge-lifi-to-0g.ts`; auto revenue-watcher trigger still ahead — [06](06-revenue-and-economics.md)
- [x] **Full agentic-commerce loop proven green** (launch→pay→sealed v4 infer→receipt→vault→snap→shareholder paid) — `smoke-e2e-full-loop.ts`
- [ ] Sell to hackers at venue (GTM) + revenue watcher — [06](06-revenue-and-economics.md)
- [x] ENS records + ERC-8004 registration + ENSIP-25-verified query_agent — [02](02-ens-erc8004.md) · *LIVE on mainnet (#55228/#55229); reputation-weighted ranking (L2) still ahead*
- [ ] Walrus storage impl + amnesia demo — [03](03-walrus.md) · *storage impl + AES + snapshot/restore + receipt pinning ✅; live amnesia-demo run + web tape remain*
- [ ] Dynamic wallet glow-up + guardrail demo — [04](04-dynamic.md)
- [ ] Demo-script agent shipped + sold — [10](10-demo-script-agent.md) · *code built (Steps 1–4, pending merge); remaining: merge, author judging-frame, deploy, sell*
- [ ] Architecture diagram (serves all 3 bounty submissions) — [07](07-build-order-checklist.md)
- [ ] ENS booth Sunday AM (mandatory, in person)

## Workstreams (who/what is moving in parallel)
- **Protocol layer** (Claude): network switch ✅, x402 v2 ✅, Walrus 🟢 (all layers built+tested), ENS/8004 🟡 (code done, funding-gated) — bounty integrations landed this session via parallel worktree agents.
- **Hermes harness**: real-Hermes fidelity ✅ (Claude, this session) — see [08](08-hermes-fidelity.md). Only live smoke + Walrus-amnesia wiring remain.
- **Web redesign** (Kilian): platform split / daylight 🟡 — [13](../13-platform-split-landing-docs.md). Claude stays out of `apps/web/*` to avoid collision unless asked.

## Maintenance rule
This file is only useful if it's true. **When you finish or start a plan item, update its
row + status here in the same commit.** Memory mirror: [[slopstock-nyc-buildplan]].
