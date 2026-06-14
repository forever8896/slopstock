# PRD — New Launch Flow with 1Claw credentials (FE + BE)

**Date:** 2026-06-14 · **Branch:** `feat/launch-rework-1claw` · **Owner:** finishing the launch-rework

## Problem (what's on prod now, why it's wrong)
The prod launch page still shows the **old 4-step template flow**: a 5-card "pick a
capability template" Step 1, a **Venice** compute toggle, and a runtime-tier selector.
None of that matches reality — the operator runtime already **forces Hermes on 0G-v4
regardless of what the UI sends** (`runtime/index.ts:62`). And the 1Claw credential
engine (`store/oneclaw.ts` + `resolveSecret`/`provisionSecret`, live & tested) is wired
into the runtime but **nothing in the launch path ever provisions a key**. So a launched
agent can never reach a credentialed tool (e.g. ElevenLabs) because its key was never
stored. This PRD closes that gap end-to-end.

## Goal
A launch flow that reflects the rework: **no templates, no Venice, Hermes-on-0G-v4**, the
**system prompt is the agent**, and the creator can **attach API keys that get stored in
1Claw at launch** (never in the manifest, model context, or receipt).

## Scope (this PRD)
- **FE** `apps/web/src/app/app/launch/launch-client.tsx`: 4 steps → 3 (`identity → review → live`);
  remove the template picker + Venice toggle + runtime-tier selector; system-prompt is a
  first-class required field; add a **credentials** section; send `credentials[]` in the
  register POST.
- **BE** `apps/operator/src/http/server.ts` register handler: accept `credentials: {ref,value}[]`,
  and after the agent record is created, **`provisionSecret` each into 1Claw** (per-agent
  path `agents/<tokenId>/<ref>`). Non-fatal + leak-safe per launch-rework §6.

## Out of scope (explicit — separate workstreams, NOT silently dropped)
- **§3 per-call revenue split router** (`revenue/router.ts`, `compute-refill.ts`) — independent
  of the launch UX; tracked in plan 06.
- **§7 auto-registration (ENS + ERC-8004) at launch** — on-chain, needs funded deployer;
  the proven scripts exist (`ens-mainnet-publish.ts`, `erc8004-register.ts`) and stay manual
  for now. Tracked in plan 02/launch-rework §7.
- Deep `apps/web` redesign (Kilian's platform-split) — we touch ONLY `launch-client.tsx`.

## BE design
`handleRegisterAgent` (already slim — no `templateId`) gains:
```
credentials?: Array<{ ref: string; value: string }>
```
After `registerDynamicAgent(record)` and before returning, for each credential with a
non-empty `value`: `await provisionSecret(cred.ref, cred.value, { tokenId, config })`.
Guarded: if 1Claw isn't configured (`SecretNotConfiguredError`) or a single put fails, log
and continue — the agent still launches (non-fatal). The plaintext value is consumed here
and never persisted to our registry/manifest/logs. Response reports `secretsProvisioned: n`.

**Acceptance (BE):** unit test — a register body with `credentials` calls `provisionSecret`
for each (via an injected resolver/mock), the agent record never contains the value, and a
1Claw-unconfigured launch still returns `ok:true`.

## FE design
- **Steps:** `WizStep = "identity" | "review" | "live"`; Rail `["identity","review + mint","go live"]`;
  Crumb `/ 03`; default `wizStep = "identity"`. Remove `PickStep` + the `"pick"` branch.
- **Identity step:**
  - Drop the **compute backend** card grid (Venice). `backend` is constant `"0g-compute"`.
  - Drop the **runtime tier** `<select>`. `runtimeTier` is constant `"hermes"`.
  - **System prompt** becomes a primary, always-visible, required textarea (placeholder
    guidance; `mint()` already rejects empty). It IS the agent.
  - **New: tool credentials (1Claw)** — rows of `{ ref, value }` (+add / ✕remove). Help text:
    "stored in 1Claw HSM at launch · the agent fetches at call time · never in the model
    context or receipt." `value` inputs are `type=password`.
  - Keep ticker, description, per-call price, skills editor.
  - `currentTemplate` removed; manifest `tools` default to a base set
    `["recall","note","query_agent"]`; `templateId` kept as a hidden constant
    (`TEMPLATE_LIST[0].id`) since the BE ignores it and the manifest type still requires it.
- **Manifest preview:** drop the `template` and Venice `backend` lines; show
  `backend  0g · intel tdx` always; tools = the base set; add a `secrets  N key(s) → 1Claw` line.
- **Register POST** (the mint→register effect): add
  `credentials: credentials.filter(c => c.ref.trim() && c.value)` to the body; keep
  `backend:"0g-compute"`, `runtime:"hermes"`.

**Acceptance (FE):** `bun --filter @stratum/web build` is green; the launch page renders 3
steps starting at identity; no "pick a capability template" and no "venice" anywhere; a
credentials row round-trips into the register body.

## Verification
- BE: `bun test` for the register-credentials unit test + existing suite green.
- FE: web build green; grep the built flow has no `TEMPLATE_LIST`/`venice` in the launch path.
- E2E (manual, optional): launch an agent with an `elevenlabs` credential → confirm
  `provisionSecret` stored it (the live `smoke-oneclaw` path already proves 1Claw works).
