# 07 — Master Build Order, Checklist & Timeline

> **The one doc to open when you don't know what to do next.** Sequenced, with
> dependencies and stop-losses. Check boxes as you go. TDD on everything.

## Dependency shape

```
NETWORK SWITCH (trunk) ──┬── x402 v2 (inbound+outbound)  ── REVENUE SPLIT + P&L
                         ├── ENS + ERC-8004 (discovery)  ── verified agent-to-agent pay
                         ├── WALRUS (manifests/receipts/memory)
                         └── DYNAMIC (wallet glow-up)     ── signs x402 v2
                                   │
                         FUNDING (user) ── MAINNET FLIP ── GTM / sell ── DEMO
```
Everything testable on testnet/free first; mainnet is a flip at the end.

## Phase 0 — User actions (parallel, unblock the mainnet half)
- [ ] **Fund wallets** (see [00-state-and-funding.md](00-state-and-funding.md)): ~0.01 L1 ETH (deployer), ~0.005 Base ETH (deployer), ~0.005 Base ETH (operator+agents), ~$5 USDC (AUDIT wallet). Fund AUDIT first.
- [ ] **Dynamic dashboard**: create env + API token (`dyn` CLI), enable embedded wallets + Base → add `DYNAMIC_ENVIRONMENT_ID`/`DYNAMIC_AUTH_TOKEN`/`WALLET_PASSWORD` to `.env`.
- [ ] (At booths) verify: Dynamic signs on 0G 16661; CDP facilitator works on Base mainnet.

## Phase 1 — Trunk (Claude, no funds needed; money moves flagged ⚠️)
- [ ] **Network switch** `network.ts` — RESUME the TDD cycle (test is RED now). Implement → green. Then `assertNetworkConfigured` guard. ([01](01-network-switch.md))
- [ ] Migrate `clients.ts` / call sites to `getNetwork()`; `addresses.ts` constants derive from testnet config.
- [ ] **Revenue split** at x402 verify seam (compute reserve + operator fee + net→vault) — TDD. ([06](06-revenue-and-economics.md))
- [ ] ⚠️ Flip AUDIT brain to deepseek-v3 mainnet (`.env` 2-liner) + smoke a real audit; confirm TEE attestation lands in receipt.

## Phase 2 — Parallel build tracks (TDD each; isolated worktrees if subagents)
- [ ] **x402 v2** ([05](05-x402-v2.md)) — server challenge + client pay + verify, against Base Sepolia keyless facilitator → green. Add Exa/CoinGecko tools.
- [ ] **ENS + ERC-8004** ([02](02-ens-erc8004.md)) — ERC-7930 helper, record writer (mainnet), ERC-8004 register, resolve+verify, swap `query_agent` off the env map.
- [ ] **Walrus** ([03](03-walrus.md)) — `WalrusStorage` (done: client) → impl interface, AES envelope, snapshot/restore, receipt pinning. Amnesia demo.
- [ ] **Dynamic** ([04](04-dynamic.md)) — wallet import, viem LocalAccount wrapper, swap signer, policies + webhook. 3-act demo. (Needs Phase 0 Dynamic dashboard.)

## Phase 3 — Integration loop (Sat evening) — merge trunk-first, verify each
- [ ] `bun test` full suite green.
- [ ] `smoke-hermes` (deepseek-v3 brain) green.
- [ ] `smoke-hermes` shows Hermes fidelity: Level-0 skill index (no body dump), `skill_view`/`skill_manage` used, skill improves in place (re-run bumps `version:` not a new file), `MEMORY.md` written. ([08](08-hermes-fidelity.md))
- [ ] `smoke-agent-to-agent` via ENS resolution + ENSIP-25 verify.
- [ ] ⚠️ **Mainnet flip** (`NETWORK=mainnet`) once funded; guard passes.
- [ ] Inbound: a real x402 v2 payment to AUDIT on mainnet.
- [ ] Outbound: AUDIT pays Exa; ORCL pays CoinGecko (real txs).
- [ ] Self-funding: agent tops up OG via LI.FI from earnings.
- [ ] Amnesia demo on mainnet config.

## Phase 4 — GTM + submission (continuous from Sat AM)
- [ ] Pricing card + curl one-liner in event Discord/Telegram.
- [ ] Revenue-watcher `/loop` (ping on stranger payment → screenshot).
- [ ] x402 Bazaar (discoverable settle) + x402scan manual register.
- [ ] Architecture diagram (one diagram serves all 3 bounty submissions: ENS→Walrus→x402/Arc loop).
- [ ] Demo video(s) ≤ required length per bounty.
- [ ] **ENS booth Sunday morning, in person (mandatory).**
- [ ] Submit ENS, Walrus, Dynamic (state clearly what was built this weekend per bounty).

## E2E test (the proof before mainnet)
A single end-to-end test on testnet exercising: register agent (ERC-8004 + ENS records) →
resolve+verify peer via ENS → x402 v2 inbound payment → revenue split → receipt pinned to
Walrus → Hermes state snapshot to Walrus → wipe → restore → outbound x402 payment to a
stub. Green here = safe to flip mainnet.

## Stop-losses (decide fast, don't agonize)
| If… | Then… |
|---|---|
| L1 gas unavailable | ENS records on Sepolia (judges accept); records still point at mainnet endpoints |
| CDP mainnet facilitator snags | self-facilitate x402; x402scan manual listing |
| Seal/encryption eats time | AES already the plan; if even that slips, memory snapshots unencrypted (note it) |
| Walrus snapshot/restore fiddly | ship manifests+receipts on Walrus (still qualifies); memory = bonus beat |
| Dynamic slips Sat night | don't submit a half-migration; Uniswap is the unspoken fallback slot |
| 0G signing via Dynamic flaky | operator key signs the LI.FI top-up directly; Dynamic policies stay Base-only |
| deepseek-v3 ledger runs low | flip to v4-flash (cheaper) or top up ledger ~5 OG |

## Invariants (never break — from [README](README.md))
1. IPO/public share sale GATED on mainnet. 2. Original 5 sponsors stay load-bearing.
3. TDD: no prod code without a failing test first. 4. One-switch network config.
