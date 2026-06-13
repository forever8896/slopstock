# 06 — Revenue, Economics & Go-To-Market

> The point of the weekend: **real revenue** + proof the agent economy is real. Bounties
> are high-margin revenue too, but this doc is the business.

## Mainnet revenue rails

Deploy the x402 paywall + RevenueVault on **Base mainnet** with real Circle USDC
(`0x8335…02913`). The whole pipeline (mint→fractionalize→subscribe→infer→distribute) can
run mainnet. Config flip is the `NETWORK` switch ([01-network-switch.md](01-network-switch.md)).

### LEGAL GATE (hard invariant)
**The IPO / public fractional share sale stays GATED on mainnet.** Selling revenue-bearing
ShareTokens to strangers is the textbook Howey/unregistered-security fact pattern
(distributions = dividends). So: deploy everything, but the IPOSale stays unfunded/disabled
on mainnet (or testnet-only). One line in the demo: *"primary share sales stay on testnet
until the CLARITY framework lands — the revenue rails are already real."* That sentence is a
maturity signal, not an apology. Distributing revenue to ourselves (we hold 100% of shares)
is just moving our own money — fine. Whole-agent acquisition (M&A) is the securities-light
motion; fractional retail is the part regulators eat first.

## Revenue split + P&L (the Blink question: "who pays for inference?")

Today: subscriber's USDC → 100% to RevenueVault; operator silently eats compute cost (COGS).
That's a subsidized marketplace — agents aren't actually profitable.

**Fix:** at the x402 verification seam, split each payment into:
`compute reserve (COGS) + operator fee + net → vault`. The 0G compute broker is a metered
prepaid ledger, so "agent revenue auto-tops-up its own compute account" is bookkeeping + one
transfer. Surface **P&L on the agent profile**: gross revenue − compute COGS = net to
shareholders. Investors price *net*; showing gross is what a sharp judge pokes at.

### Unit economics (deepseek on 0G, OG ≈ $0.29)
- deepseek-v3-0324: ~0.07 OG/audit (~$0.02). AUDIT at $0.50 → ~96% gross margin.
- deepseek-v4-pro: ~0.33 OG/audit (~$0.10) → ~80% margin. v4-flash ~12× cheaper than pro.
- Binding constraint is ledger balance, not margin. 5.83 OG in the v3 sub-account ≈ ~80 audits ready now.

## Self-funding loop (the beautiful demo)

Closes the last gap: revenue is USDC on Base, compute is OG on 0G. LI.FI bridges it.
1. AUDIT earns USDC on Base (x402).
2. Operator watches the 0G broker ledger; below threshold → LI.FI: USDC→native OG
   (verified working: 10 USDC → 33.36 OG, ~10s, gasZipBridge, ~3.5% cost).
3. `broker.ledger.depositFund()` → agent keeps running on its own earnings.
4. The top-up lands in the receipt chain → shows in P&L.

**LI.FI = raw quote API (`li.quest/v1/quote`), NOT Composer.** Composer adds nothing the
product needs; the bounty requires Composer and the user is not motivated by it. (If 0G
signing via Dynamic is flaky, the operator key signs the top-up tx directly.)

## Go-to-market (sell at the venue — start Saturday AM, not Sunday)

The venue is the market: hundreds of teams writing Solidity under deadline.
1. **AUDIT as a service:** "x402-payable contract sanity check, $0.50, 30s, curl one-liner."
   Card + drop in event Discord/Telegram + demo at table. Scope honestly: "pre-audit sanity
   check," not "replaces auditors" (de-LARP applies to our own agents first).
2. **ORCL as agent infra:** every team building for agentic bounties needs something for
   their agent to autonomously pay. ORCL is a ready x402 counterparty — "make your
   agent-pays-for-services demo real in 10 min." We sell demo-completion to other teams.
3. **Revenue watcher loop:** a `/loop`-driven watcher pings when a stranger's wallet pays,
   so we screenshot it live. Even $20 from 15 distinct wallets is a result no other
   continuity team will have.

## Compute brain
See [00-state-and-funding.md](00-state-and-funding.md). AUDIT → deepseek-v3 mainnet (TeeML,
funded, ready); v4-pro/flash = one-env-var upgrade for the "frontier model" beat. The win is
the **real sealed attestation** (no placeholder), not raw capability (it's already on 480b Venice).

## Acceptance criteria
- [ ] Revenue rails live on Base mainnet; IPO gated/disabled (documented).
- [ ] Per-call split implemented; P&L (gross/COGS/net) on the agent profile with real numbers.
- [ ] Self-funding top-up demonstrated (agent buys its own OG via LI.FI from earnings).
- [ ] ≥1 real external payment captured (Basescan link) — the closing slide.
