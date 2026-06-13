# Launch rework — Hermes-only, 0G-v4, pay-as-you-infer, 1Claw credentials, auto-registration

> Design spec · 2026-06-13 · status: approved (brainstorm) → planning
> Supersedes the preset/manifest/multi-runtime launch flow.

## Motivation

The launch flow accreted a matrix of choices — 5 capability **presets** (`templates.ts`),
3 **runtimes** (`openai-compat`/`tools-lite`/`hermes`), 2 **compute backends**
(Venice/`0g-compute`), manifests, `runtimeTier`. With the real Hermes harness proven on
0G-mainnet deepseek-v4, that optionality is dead weight. This rework collapses it to **one
shape** and makes every launch produce a **complete, first-class agent** in a single call:
Hermes-brained, revenue-bearing, self-funding, credential-capable, and discoverable/verifiable.

## Locked decisions (from brainstorm)

1. **No presets.** Free-form `systemPrompt` instead of templates.
2. **One harness:** Hermes only.
3. **One provider:** 0G-mainnet deepseek-v4-flash (single `ZG_COMPUTE_PROVIDER_ADDRESS`).
4. **Funding model:** per-call (pay-as-you-infer) USDC→0G swap. Realistically *call-triggered
   threshold refill* (0G needs ≥1 OG min sub-account funding; LI.FI ~3.5% + ~10s).
5. **Network:** full **Base mainnet** (real USDC; LI.FI has no testnet routes). IPO stays gated.
6. **Compute pool:** single **shared operator 0G sub-account**, metered per-agent.
7. **Revenue split:** **operator splits per call** (option B) — `x402 payTo` = operator router
   wallet; compute slice retained for COGS, shareholder slice forwarded to the agent vault.
8. **Credentials:** **operator-custodial 1Claw, per-agent vault path**; secrets provisioned at
   launch, retrieved at the tool layer, never in LLM context.
9. **Auto-registration on launch:** ENS (ENSIP-26/25) + ERC-8004 (→ 8004scan), in scope.

## Design

### 1. Slim launch contract
```
POST /agents/register
{ ticker, name, description, systemPrompt, perCallUsd, creator, mintTxHash,
  tools?: [ { name, secrets?: { <SECRET_REF>: "<value>" } } ] }
```
No `template`/`runtime`/`backend`/`model`/`manifest`/`runtimeTier`. `perCallUsd` is enforced
≥ the COGS floor at register time (§3). `tools[]` opts into credentialed tools and supplies
their keys once (§4).

### 2. Forced runtime + provider
Runtime router's dynamic branch → **always `HermesAgentRuntime` + `0g-compute`** at the single
v4 provider. The "manifest-required-for-Hermes" gate is removed. The agent dir is seeded from a
minimal base skill set + the creator's `systemPrompt`; it self-improves from there.

### 3. Per-call split + USDC→0G swap (operator router)
`x402 payTo` = operator **router wallet**. Each paid call:
1. Settle real Base-mainnet USDC to the router.
2. **Split:** `computeSlice` (metered COGS + margin) retained as operator USDC; `shareholderSlice`
   (remainder) forwarded to the agent's `RevenueVault` (one USDC transfer).
3. **Refill-if-low:** if the shared v4 sub-account is below ~K calls of credit, fire a **LI.FI
   USDC→0G swap** from accumulated compute USDC → `depositFund`/`transferFund`.
4. **Infer** on 0G v4 (Hermes); **meter OG spent → attribute to this agent** (receipts + per-agent
   COGS ledger → cost-display UX).
5. Receipt carries `computeCostOG`, `settlementTx`, `shareholderForwardTx`, `swapTx?`.

`computeSlice` covers **0G inference + 1Claw retrieval cost** + margin; `perCallUsd ≥ COGS floor`.

### 4. Skills + credentials via 1Claw
- *Skills* = markdown knowledge (self-improvable, **never hold secrets**). *Tools* = handlers that
  may call external APIs. **Credentials attach to tools, not markdown skills.**
- **Declaration:** a credentialed tool declares `{ name, service, secretRef }`. Base tools
  (`read_file`, `parse_ast`, `query_agent`, `web_search` via x402-native Exa) need no key.
- **Provisioning (launch):** for each enabled credentialed tool, operator `PUT`s the key to 1Claw
  at `vaults/<opVault>/secrets/agents/<tokenId>/<secretRef>` with a **read-only policy scoped to
  that agent**. The plaintext key is taken from the register body once and **never persisted** in
  our DB/manifest/logs.
- **Retrieval (runtime):** `ToolCtx` gains `resolveSecret(secretRef)` → fetches from 1Claw
  (operator JWT, path-scoped), used **inside the handler** for the outbound call, never returned to
  the model/transcript. 1Claw billed over **x402** (folded into `computeSlice`).
- **1Claw API used:** `POST /v1/agents` (provision, once, operator-level) → `ocv_…` key;
  `POST /v1/auth/agent-token` → short-lived JWT (cached); `PUT /v1/vaults/:vault/secrets/:path`
  (store); `GET /v1/vaults/:vault/secrets/:path` (retrieve). Base URL `https://api.1claw.xyz`.

### 5. Removed / migrated
Delete `templates.ts` / `TEMPLATE_LIST` / `GET /templates` / `templateId` from the launch path;
drop `tools-lite` + `openai-compat` runtimes from launch (legacy seed tokens stay `deprecated`);
finance stack deploys on **Base mainnet** (Circle USDC, IPO gated).

### 6. Error handling
- Swap/0G fail with empty pool → **refund subscriber from router**, return "compute unavailable."
- Shareholder-forward fail → retry w/ backoff; slice owed + reconciled.
- 1Claw fetch fail on a credentialed tool → that **tool** errors gracefully (Hermes recovers); the
  call still completes for non-credentialed work; never leak the secret in the error.
- `perCallUsd` < COGS floor → rejected at register.
- Auto-registration step failure (§8) → non-fatal; agent still launches; registration retriable.

### 7. Auto-registration on launch (ENS + ERC-8004)
After the vault exists in `deploy-finance`, the operator runs (reusing the proven scripts as inline
functions):
1. **ERC-8004** `register(agentURI)` (simulate-first) on Base-mainnet IdentityRegistry → `agentId`.
2. **Mainnet ENS subname** `<ticker>.slopstock.eth` (PublicResolver, deployer-owned).
3. **ENSIP-26 records:** `agent-context` (incl. `agentId: N`), `agent-endpoint[x402]` =
   `slopstock.tech/x402/infer?tokenId=N`, `agent-endpoint[web]` = `slopstock.tech/app/agent/<TICKER>`,
   `addr` → vault.
4. **ENSIP-25:** `agent-registration[interop(8453,registry)][agentId] = "1"`.
5. **Agent card** (`agentURI`) → **Walrus** JSON, then `setAgentURI` → 8004scan renders full
   metadata; ties ENS + Walrus + 8004.

## Module / file breakdown (for the plan)

- `apps/operator/src/http/server.ts` — slim register handler; remove `/templates`; orchestrate
  provisioning (1Claw secrets §4, auto-registration §7); x402 `payTo` → router.
- `apps/operator/src/runtime/index.ts` — dynamic branch always Hermes + `0g-compute` v4; drop the
  manifest gate.
- `apps/operator/src/runtime/hermes-tools.ts` — `ToolCtx.resolveSecret`; credentialed-tool
  declaration `{ service, secretRef }`; example credentialed tool.
- **new** `apps/operator/src/store/oneclaw.ts` — 1Claw client (provision/JWT/get/put), JWT cache.
- **new** `apps/operator/src/revenue/router.ts` — per-call split (computeSlice/shareholderSlice),
  forward-to-vault, refund-on-failure, per-agent COGS ledger + metering.
- **new** `apps/operator/src/runtime/compute-refill.ts` — threshold check + LI.FI USDC→0G swap
  (generalize `bridge-lifi-to-0g.ts`: Base USDC → 0G OG) + `depositFund`/`transferFund`.
- `apps/operator/src/store/finance-deploy.ts` — confirm Base-mainnet path (Circle USDC, IPO gated).
- **new** `apps/operator/src/store/agent-registration.ts` — §7 ENS + 8004 + Walrus-card as
  reusable operator functions (lifted from the `ens-mainnet-publish.ts`/`erc8004-register.ts` scripts).
- `apps/operator/src/store/ens-subname.ts` — generalize subname creation to mainnet.
- `packages/shared/src/templates.ts` — delete; remove exports/usages.
- config — `NETWORK=mainnet`, single v4 provider, `ROUTER_PRIVATE_KEY`/wallet, `ONECLAW_API_KEY`,
  Walrus envs.

## External dependencies / blockers (gate LIVE run, not the code)

- **1Claw account + `ocv_…` api_key** (register operator agent with 1Claw / Kevin). Until then,
  `oneclaw.ts` is built + unit-tested against the documented contract but can't do a live store/fetch.
- **Base-mainnet deployer funding** for the finance-stack deploys (deployer Base ETH is thin).
- **Real mainnet USDC** for a live per-call integration test.
- **LI.FI Base-USDC→0G-OG route** confirmation (plan-06 noted ~10 USDC→33.36 OG; re-quote at build).

## Testing

- **Unit:** split math; COGS floor incl. 1Claw cost; refill threshold; `resolveSecret` never
  surfaces the value; register-contract validation; price-floor enforcement.
- **Integration (mainnet, tiny amounts):** pay → split (vault + pool both move) → low-pool LI.FI
  swap → v4 infer → receipt with real `computeCostOG`; plus a credentialed-tool path that provisions
  a key to 1Claw at launch and retrieves it at call time **without it appearing in the transcript**;
  plus auto-registration producing a live ENS + 8004scan entry. (`smoke-e2e-full-loop.ts` successor.)

## Out of scope

- Per-agent 1Claw agent registration (operator-custodial chosen).
- On-chain `RevenueRouter` contract (operator splits off-chain for now; revisit for trustlessness).
- L2 reputation-weighted `query_agent` ranking.

## Risks

- Real mainnet money in play (USDC + OG); operator briefly custodies USDC (split) + secrets (1Claw).
- Refund-on-compute-failure must be correct (never charge without delivering).
- 1Claw availability / latency on the hot path (mitigate: JWT cache, graceful per-tool failure).
