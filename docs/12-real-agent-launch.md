# 12 · Real-Agent Launch

**Status:** Proposed (2026-05-04, Monday). Target rehearsal-ready Tuesday morning, finale-ready Tuesday night. Finale livestream Wednesday 11:00–12:30 ET.

**Authors:** Kilian + Claude (pair).

**One-line pitch:** Today the `/launch` page produces a chatbot — a system prompt and a model. By Wednesday it produces an *agent* — capabilities, tools, sealed artifacts on 0G Storage, and (stretch) the same Hermes-pattern runtime that powers `auditor.slopstock.eth`. Anyone in the audience can mint an agent live on stage and watch it call other agents on chain.

---

## 0 · Why this is one feature

Three weaknesses of the current demo, each of which is the same engineering project:

1. **An "agent" is just a system prompt + model.** Permissionless mints can't do anything the demo trio can — no tools, no agent-to-agent calls, no persisted memory.
2. **0G Storage is decorative.** The README mentions "sealed weights conceptually on 0G Storage" and we're targeting an iNFT prize, but no code touches 0G Storage. Today's `metadataHash` on the iNFT is `keccak256` of a small JSON string; it commits to nothing real.
3. **Hermes is gated.** Only the static trio can use Hermes-pattern. Comment in `apps/operator/src/runtime/index.ts:78` reads literally: *"Hermes-pattern still requires seed files; v1 dynamic agents are openai-compat runtime even when the backend is 0G Compute."*

These three problems unlock as one feature, because:

- Skills + tools require a place to put per-agent artifacts (system prompt, tool schemas, pattern library, skill docs, optional seed bundle). Today that place is `apps/operator/seed/agents/<id>/` on disk, which a browser-only mint can't write to. **0G Storage is exactly the place.**
- Once 0G Storage is the artifact layer, *every* permissionless mint can pin a real bundle, and Hermes-pattern stops being gated. The browser pins the manifest; the operator pulls it on first call.
- Once Hermes (or even a "Hermes-lite" in-process variant) can run for permissionless agents, capability templates become real — picking a template at mint time selects a system-prompt + tool-set + pattern-library bundle that gets pinned to 0G Storage.

So: **one feature, three sponsor wins** (0G Storage iNFT track, agent-framework track, and a stronger 0G Compute story since launched agents now have *something to attest the integrity of*).

---

## 1 · Current state, in code

This section is the unromantic ground truth. Every file referenced was read on 2026-05-04 against `92b3126 final commit` plus the WIP per-agent backend changes.

### 1.1 The launch page (`apps/web/src/app/launch/launch-client.tsx`)

A 4-section form. After mint, three follow-up actions (deploy finance, test, view profile).

| Section | What it captures | Backed by |
|---|---|---|
| 01 · ticker + name + description | string fields | client-only, posted to operator at register |
| 02 · system prompt + 4 preset prompts | one big textarea, four one-click presets | client-only |
| 03 · compute backend (WIP) + Venice model picker | radio + 5-model list | passed to operator as `backend` + `model` |
| 04 · price | dollar input (perCall, USDC) | passed to operator as `perCallSmallest` |

Mint flow: builds a 6-line `metadataJson` string of `{ ticker, description, systemPrompt, model, perCallSmallest, creator }`, hashes it (`keccak256`), calls `AgentNFT.mint(to, metadataHash, metadataURI, sealedKey, teeAttestation)` on 0G Galileo. After mint succeeds, POSTs to `${OPERATOR_URL}/agents/register` with the same fields.

**The on-chain `metadataHash` today commits to a tiny JSON of user-typed strings. There is no content-addressable artifact behind it.** That's the gap.

### 1.2 The operator's dynamic registry (`apps/operator/src/store/dynamic-registry.ts`)

A `DynamicAgent` record has 9 stable fields plus the new `backend`. There is no `template`, no `bundleManifestCid`, no `tools`, no `seedBundleCid`. The system prompt is a single string column.

### 1.3 Runtime routing (`apps/operator/src/runtime/index.ts`)

Two orthogonal axes — runtime (`openai-compat | hermes`) × backend (`openai-compat | 0g-compute`). For dynamic agents the WIP code already plumbs the backend choice through. The runtime is pinned to `openai-compat` with the comment cited above. Hermes is unreachable for any dynamic agent.

### 1.4 The OpenAICompat runtime (`apps/operator/src/runtime/openai-compat.ts`)

A literal one-shot LLM call:
- Single `messages: [system, user]`
- `temperature: 0.1`, `jsonMode: true`
- Returns `{ output, inputHash, outputHash, transcript: [one llm step], bundleHash = keccak256("runtime=openai-compat:backend=…:prompt=<12-char hash>") }`
- No tools, no loops, no skills. `skillsLoaded: []`, `skillsCreated: []`. Always.

### 1.5 The Hermes runtime (`apps/operator/src/runtime/hermes*.ts`, ~1300 lines)

Real agent: tool registry (`parse_ast`, `pattern_search`, `recall`, `note`, `query_agent`), per-tokenId memory db, multi-step loop, transcript shows every tool call, bundleHash hashes the on-disk `apps/operator/seed/agents/<tokenId>/` directory recursively. The 5 patterns + 3 skills under `seed/agents/1/` are hand-authored markdown that the auditor reads via `pattern_search`.

The Hermes runtime expects a real directory. There is no abstraction over "where artifacts come from"; `ctx.agentDir` is literal on-disk.

### 1.6 0G Storage usage today

```
$ grep -r "0g.storage\|@0glabs/0g-ts-sdk\|StorageNode" apps packages
(no results)
```

Zero. New integration.

---

## 2 · Target architecture

The launch flow becomes:

```
   ┌────────────────── browser ──────────────────────┐
   │ launch page                                     │
   │   1. ticker + name + description                │
   │   2. capability template (NEW — 5 templates)    │
   │   3. compute backend (Venice / 0G Compute)      │
   │   4. runtime tier (NEW — 3 tiers selectable)    │
   │   5. price                                      │
   │                                                 │
   │  ─→ assemble manifest                           │
   │  ─→ pin to 0G Storage  (NEW)                    │
   │  ─→ AgentNFT.mint(..., metadataHash = root)     │
   │  ─→ POST operator /agents/register              │
   └────────────────────┬────────────────────────────┘
                        │
   ┌────────────────────┴───── operator ─────────────┐
   │ /agents/register                                │
   │   stores DynamicAgent + bundleManifestCid       │
   │ /agents/:id/deploy-finance                      │
   │   unchanged                                     │
   │ /x402/infer (first call, cold start)            │
   │   ↳ pull manifest from 0G Storage (NEW)         │
   │   ↳ verify root matches on-chain metadataHash   │
   │   ↳ materialize agentDir to /tmp                │
   │   ↳ build runtime per template+tier             │
   │   ↳ run task with real tools                    │
   └─────────────────────────────────────────────────┘
```

Six concrete components:

1. **Capability templates** (web + operator, shared package).
2. **Manifest** — content-addressable bundle that goes on 0G Storage.
3. **0G Storage SDK integration** (web + operator).
4. **Runtime tier ladder** — three tiers spanning today's openai-compat and Hermes.
5. **bundleHash / metadataHash** unified semantics.
6. **Launch UI redesign** — section 02 becomes "template," section 04 becomes "tier."

---

## 3 · Capability templates

A *template* is a complete recipe for "how this agent thinks and what it can do." It lives in a new shared package so both the web app (for picker UI) and the operator (for runtime materialization) consume the exact same record.

### 3.1 Schema

```ts
// packages/shared/src/templates.ts
export interface CapabilityTemplate {
  id: string;                      // "code-auditor", "data-oracle", …
  label: string;                   // human-friendly
  blurb: string;                   // 1-line for the picker card
  systemPrompt: string;            // baseline; user can edit
  defaultModel: string;            // suggested Venice model
  suggestedTier: RuntimeTier;      // openai-compat | tools-lite | hermes
  tools: ToolName[];               // subset of TOOL_REGISTRY keys
  patterns?: { name: string; body: string }[];   // markdown bodies
  skills?:   { name: string; body: string }[];   // markdown bodies
  /** Sponsor angle for the demo. Shown in picker card as a tiny tag. */
  sponsorTag?: "0G iNFT" | "0G Compute" | "Uniswap" | "ENS" | "agent-economy";
}

export type RuntimeTier = "openai-compat" | "tools-lite" | "hermes";
export type ToolName =
  | "parse_ast" | "pattern_search" | "recall" | "note" | "query_agent"
  | "fetch_url" | "onchain_read" | "image_gen";
```

### 3.2 The five shipping templates

| id | label | tools | tier | sponsor angle |
|---|---|---|---|---|
| `code-auditor` | Solidity auditor | `parse_ast`, `pattern_search`, `recall`, `note`, `query_agent` | `hermes` | 0G iNFT (full Hermes) |
| `data-oracle` | data-oracle | `fetch_url`, `onchain_read`, `note` | `tools-lite` | agent-economy (gets called by other agents) |
| `meme-creator` | meme-creator | `image_gen`, `note` | `tools-lite` | agent-economy |
| `research-analyst` | research-analyst | `fetch_url`, `recall`, `note` | `tools-lite` | 0G Compute (TEE'd web research) |
| `cross-agent-orchestrator` | x-agent-orchestrator | `query_agent`, `recall`, `note` | `tools-lite` | agent-economy + ENS |

The `cross-agent-orchestrator` is the headline template for the demo — the live-minted agent gets the `query_agent` tool, so it can call AUDIT/MEMER/ORCL via real ENS resolution and pay them in real USDC. **That's the moment.**

### 3.3 Three new tools to build

The five existing tools are reused as-is. The three new ones:

- **`fetch_url(url)`** — HTTP GET, returns first 4kB of text. SSRF guard (no localhost / RFC1918).
- **`onchain_read(network, address, abi, function, args)`** — generic `viem` `readContract`. Whitelisted networks: `base-sepolia`, `sepolia`, `0g-galileo`. ABI passed inline (small).
- **`image_gen(prompt)`** — calls Venice's image endpoint, returns a CID stored on 0G Storage and a viewable URL. Best-effort; falls back to a stub URL if Venice image API isn't reachable.

All three have the same `ToolDef` interface as `hermes-tools.ts:32` — drop-in registry entries.

### 3.4 Where templates are materialized to artifacts

A template doesn't store *files* in the package — it stores *content*. At mint time, the browser walks the picked template, builds the manifest (see §4), and pins it. At runtime, the operator pulls it back. Templates are pure data — no I/O.

---

## 4 · The manifest — what gets pinned

The atom on 0G Storage is the **bundle manifest**, a single JSON document that fully describes an agent's identity. The iNFT's on-chain `metadataHash` becomes `keccak256(canonical(manifest))`, and `metadataURI` becomes `0g-storage://<rootHash>`.

### 4.1 Manifest schema

```ts
// packages/shared/src/manifest.ts
export interface AgentManifest {
  schemaVersion: "stratum/agent-manifest@1";
  identity: {
    ticker: string;
    name: string;
    description: string;
    creator: `0x${string}`;
  };
  brain: {
    templateId: string;
    systemPrompt: string;        // possibly edited by user
    model: string;               // Venice id or "0g-tee-provider-served"
    backend: "openai-compat" | "0g-compute";
    runtimeTier: RuntimeTier;
  };
  capabilities: {
    tools: ToolName[];           // realized from template + user edits
    patterns: { name: string; cid: string }[];   // each one its own 0G Storage entry
    skills:   { name: string; cid: string }[];
  };
  pricing: {
    perCallSmallest: string;     // USDC, smallest unit
  };
  meta: {
    createdAt: number;
    operatorHint?: string;       // optional URL where this agent is served
  };
}
```

### 4.2 Canonical serialization

JSON.stringify with sorted keys at every depth (we already have a similar helper in `packages/shared`). Pin both per-pattern and per-skill markdown as separate 0G Storage entries — keeps the manifest small and makes them individually addressable.

### 4.3 On-chain commitments

```
AgentNFT.mint(
  to               = creator,
  metadataHash     = keccak256(canonical(manifest)),    // changed
  metadataURI      = `0g-storage://${rootHash}`,        // changed
  sealedKey        = 0x (unchanged for now),
  teeAttestation   = 0x (unchanged for now),
);
```

Critically: the `metadataHash` now binds the manifest, which transitively binds every tool, pattern, and skill (each has its own CID). Tampering with any of them invalidates the on-chain commit. **That's the iNFT story sponsors are paying for.**

---

## 5 · 0G Storage integration

### 5.1 SDK choice

Two paths:

- **Option A — `@0glabs/0g-ts-sdk` (full, browser-friendly).** The official TS SDK. Pros: real, idiomatic. Cons: bundle size, possible Node-only deps that need polyfilling for Next.js.
- **Option B — direct REST against an indexer.** 0G Storage exposes an indexer HTTP API. Pros: trivially works in browsers, no SDK risk. Cons: have to compute Merkle root manually.

**Decision:** start with Option A for the browser side. If bundle / SSR issues bite, fall back to a tiny `apps/web/src/lib/og-storage.ts` wrapper that POSTs to a small Next.js API route, which uses the SDK in Node. Either way, the operator side is unambiguously SDK in Node.

### 5.2 New module: `packages/shared/src/og-storage.ts`

```ts
export interface OgStorageClient {
  pinJson(obj: unknown): Promise<{ rootHash: string; size: number }>;
  pinText(content: string): Promise<{ rootHash: string; size: number }>;
  fetchJson<T = unknown>(rootHash: string): Promise<T>;
  fetchText(rootHash: string): Promise<string>;
}
export function createOgStorageClient(opts: {
  indexerUrl: string;            // e.g. https://indexer-storage-testnet-turbo.0g.ai
  rpcUrl: string;                // 0G Galileo RPC
  signerKey?: `0x${string}`;     // optional — for paid uploads
}): OgStorageClient;
```

A bare-bones interface. Both `apps/web` and `apps/operator` consume it. The operator may also use it for *writing* (e.g. `image_gen` results), which is why the signer key is optional in the constructor but required for those calls.

### 5.3 Failure modes (and how we degrade)

- **Indexer unreachable from browser at mint time:** show a clear UI error before submitting the on-chain mint. Mint must not happen if the manifest didn't pin (otherwise we mint a dangling iNFT).
- **Indexer unreachable from operator at first inference:** retry 3× with exponential backoff, then fall back to *registry-stored* manifest copy (we save the manifest body in the operator's dynamic registry as a defensive shadow). On rehearsal we'll prefer the 0G Storage copy; the shadow exists for live-demo safety only.
- **Hash mismatch on pull:** hard error. Refuse to serve the agent. The whole point of pinning a hash on chain is that we honor it.

### 5.4 Cache strategy on operator

Per-tokenId LRU keyed by `bundleManifestCid`, max 32 agents in memory at once. Manifest fetch on cold start, materialize to `/tmp/operator-bundles/<tokenId>/` for Hermes runtime that expects a directory. Eviction unmounts the tmp dir.

---

## 6 · The runtime tier ladder

Today: `openai-compat` (one-shot, no tools) **or** `hermes` (full agent loop, requires on-disk bundle). That's a cliff. We add a middle tier.

```
Tier               State          Tools  Loop  bundle source
─────────────────  ─────────────  ─────  ────  ────────────────────────────────
openai-compat      stateless      —      no    none (system prompt only)
tools-lite         per-call       yes    yes¹  manifest from 0G Storage
hermes             persistent²    yes    yes   manifest → /tmp dir, mem db, etc
```

¹ `tools-lite` runs the *same* tool-call loop as Hermes but doesn't persist memory between calls — each call gets a fresh ephemeral `recall`/`note` scratchpad backed by an in-memory SQLite. Bundle is read-only (patterns + skills + system prompt).

² `hermes` keeps a per-tokenId on-disk SQLite db at `/tmp/operator-state/<tokenId>/`. State persists across calls.

### 6.1 New: `tools-lite` runtime

A new file `apps/operator/src/runtime/tools-lite.ts`. It is **the Hermes loop with two changes**:

1. `agentDir` points at the materialized 0G Storage bundle (read-only).
2. The memory db is `:memory:` SQLite, fresh per call.

So we lift the Hermes loop body into a shared helper (`runAgentLoop(ctx)`), then both `hermes.ts` and `tools-lite.ts` invoke it with their own `ToolCtx`. ~150 LOC of refactor in `hermes-loop.ts` plus the new file.

### 6.2 The router (`apps/operator/src/runtime/index.ts`)

```ts
if (dyn) {
  const manifest = await loadManifest(dyn.bundleManifestCid);  // NEW
  const tier = manifest.brain.runtimeTier;
  const backend = await this.backendFor(manifest.brain.backend);
  const agentDir = await materializeBundle(manifest);           // NEW
  switch (tier) {
    case "openai-compat":  return new OpenAICompatRuntime(backend, { systemPromptOverride: manifest.brain.systemPrompt });
    case "tools-lite":     return new ToolsLiteRuntime(backend, { manifest, agentDir });
    case "hermes":         return new HermesAgentRuntime(this.config, backend).withManifest(manifest, agentDir);
  }
}
```

Hermes-from-manifest needs a small extension on `HermesAgentRuntime` that swaps `apps/operator/seed/agents/<id>/` for the materialized dir. ~30 LOC.

### 6.3 Tool whitelist per agent

The runtime pulls the tool list from `manifest.capabilities.tools` and exposes only those — the model literally doesn't see tools the creator didn't enable. Cleaner UX (the LLM doesn't try `query_agent` if the template didn't include it) and a reasonable security posture.

---

## 7 · bundleHash / metadataHash semantics

Three hashes today are conflated; let's pull them apart so each binds the right thing:

| Name | Where | Today | After |
|---|---|---|---|
| `metadataHash` | on-chain on iNFT | `keccak256(json blob)` | `keccak256(canonical(manifest))` |
| `metadataURI` | on-chain on iNFT | `""` or junk | `0g-storage://<rootHash>` |
| `bundleHash` | per-task in receipts | `keccak256("runtime=…:prompt=…")` | `keccak256(canonical(manifest))` AND for hermes, `keccak256(materialized dir)` |

`bundleHash` becoming equal to `metadataHash` for tools-lite is fine — *the manifest is the bundle*. For hermes-with-state, the bundle hash drifts as memory accrues; the manifest hash is the *initial* state, which is exactly the semantics we want for a stock-exchange-of-agents (the iNFT pins the agent's identity at mint).

---

## 8 · Launch page redesign

Five sections instead of four. Sequence chosen so the user makes the *capability decision* before seeing the system prompt — the prompt becomes a refinement, not the substance.

```
01 · ticker + name + description
02 · capability template      ← NEW (replaces the inline preset prompts)
03 · compute backend           ← unchanged (Venice / 0G Compute)
04 · runtime tier              ← NEW (three buttons; default = template's suggested)
05 · price                     ← unchanged
```

### 8.1 Section 02 · capability template

Five `pay-card` buttons (existing component pattern) showing label, blurb, sponsor tag, and a tools-list pill row. Picking a card:
- replaces `systemPrompt` with the template's baseline (user can still edit afterwards)
- sets `model` and `runtimeTier` to template defaults (still overridable)
- swaps the section-04 default

A small "edit prompt" disclosure expands the editable textarea. We don't hide the prompt entirely — judges will want to see it.

### 8.2 Section 04 · runtime tier

Three cards:
- **openai-compat** — "single-shot. fastest, simplest, no tools."
- **tools-lite** — "per-call agent loop with selected tools. fresh memory each call." (default for most templates)
- **hermes** — "full agent. persistent memory, multi-turn, the same runtime AUDIT uses." Tagged with a small "experimental for permissionless" badge.

### 8.3 The "what gets minted" panel

Rewrite. The current right-hand panel shows a tee/ascii-art block listing operator-side things. Replace with:

```
┌─ on-chain on 0G Galileo ────────┐
│ AgentNFT.mint(                  │
│   to:           your wallet     │
│   metadataHash: keccak(manifest)│   ← real binding now
│   metadataURI:  0g-storage://…  │
│ )                               │
└─ on 0G Storage ─────────────────┘
│ manifest.json     (root)        │
│ ├ pattern/*.md    (per-cid)     │
│ └ skill/*.md      (per-cid)     │
└─ on operator (post-mint) ───────┘
│ POST /agents/register           │
│   bundleManifestCid: 0g…        │
└─────────────────────────────────┘
```

This panel is half the demo. It tells the audience the iNFT is real because the hash on chain is the hash of content on 0G Storage.

### 8.4 Post-mint actions

Unchanged in spirit. After registration: deploy finance, test the agent, view profile. Test endpoint must now exercise the real tool loop, not just a one-shot. Adds ~5–8s of latency on first test (manifest fetch + materialize), but feels right — first inference *should* feel weighty.

---

## 9 · Operator changes — concrete diff

### 9.1 New / modified files

| File | Change |
|---|---|
| `packages/shared/src/templates.ts` | NEW — five templates, types |
| `packages/shared/src/manifest.ts` | NEW — schema + canonicalize + hash |
| `packages/shared/src/og-storage.ts` | NEW — interface + factory |
| `apps/operator/package.json` | + `@0glabs/0g-ts-sdk` |
| `apps/operator/src/store/dynamic-registry.ts` | + `bundleManifestCid: string` field; manifest shadow copy column |
| `apps/operator/src/http/server.ts` | `/agents/register` accepts `bundleManifestCid`; new `/templates` endpoint (lists shipping templates so the web app + judges can introspect) |
| `apps/operator/src/runtime/manifest-loader.ts` | NEW — fetch + verify + materialize-to-dir |
| `apps/operator/src/runtime/tools-lite.ts` | NEW — middle tier |
| `apps/operator/src/runtime/hermes-loop.ts` | refactor — extract `runAgentLoop` so tools-lite and hermes share it |
| `apps/operator/src/runtime/hermes.ts` | + `withManifest()` to point agentDir at materialized bundle |
| `apps/operator/src/runtime/index.ts` | router branches on `manifest.brain.runtimeTier` |
| `apps/operator/src/runtime/hermes-tools.ts` | + `fetch_url`, + `onchain_read`, + `image_gen` |
| `apps/web/package.json` | + `@0glabs/0g-ts-sdk` (or wrapper route) |
| `apps/web/src/lib/og-storage.ts` | NEW — browser-side pin/fetch |
| `apps/web/src/app/launch/launch-client.tsx` | redesign sections 02 + 04; new manifest assembly + pin step |
| `apps/web/src/lib/agents.ts` | already extended for dynamic agents (WIP) — add `template` and `tools` to the agent profile reading code |
| `apps/web/src/app/agent/[ticker]/page.tsx` | show template + tools on profile (small) |

### 9.2 `/agents/register` payload (new)

```json
{
  "tokenId": "...",
  "creator": "0x...",
  "txHash": "0x...",
  "bundleManifestCid": "0g-storage://...",
  "manifest": { /* full manifest, defensive shadow */ }
}
```

The operator verifies `keccak256(canonical(manifest))` matches the on-chain `metadataHash` (read from the iNFT) before accepting. If not — 400.

---

## 10 · The 5-minute demo arc

```
0:00 — 0:30   "Today there are agents that do things. We made productive
              property out of them. Watch."
              [home page · live cumulative revenue counter]
0:30 — 1:30   "These three agents — AUDIT, ORCL, MEMER — are listed.
              They earn revenue. Their shareholders get paid pro-rata.
              And they pay each other on chain."
              [click AUDIT, show TEE-attested receipt; click receipts tape;
               show the AUDIT→ORCL tx on Basescan]
1:30 — 4:00   "Now anyone can do this. Permissionlessly. Live."
              [open /launch in a new tab]
              [pick a meaningful ticker the audience suggests, e.g. WHALE]
              [click cross-agent-orchestrator template]
              [point at section 03, pick 0G Compute backend, narrate why]
              [click Mint]
              [10 seconds: manifest pins, tx confirms, registry updates]
              [click "test"; the agent calls ORCL via query_agent on chain]
              [show the Basescan tx — same flow as AUDIT→ORCL, just live]
4:00 — 5:00   "metadataHash on the iNFT is the hash of the manifest on
              0G Storage. The same primitive that lets AUDIT exist lets
              this agent exist 90 seconds after we typed its name."
              [show the `0g-storage://...` URI clickable, content visible]
              [show the homepage now lists WHALE alongside AUDIT/MEMER/ORCL]
```

The arc has redundancy: even if step 3 (tools-lite x402 to ORCL) fails, the manifest pin + on-chain hash story is intact and we can pivot to "and here's the receipt from AUDIT calling ORCL, same flow."

---

## 11 · Phase split

### 11.1 Phase 1 — rehearsal-safe (target: Tuesday 2026-05-05 morning)

Everything required for the demo arc *except* full Hermes for permissionless mints. Specifically:

- `packages/shared/{templates,manifest,og-storage}.ts` complete
- 0G Storage browser pin + operator fetch working end-to-end
- Manifest verification on register
- `tools-lite` runtime, with `runAgentLoop` extracted from Hermes
- The 5 templates, all 5 selectable in launch UI
- `fetch_url`, `onchain_read`, `image_gen` tools
- Launch page redesigned (sections 02 + 04 new)
- `cross-agent-orchestrator` template's `query_agent` tool calls the static trio successfully
- Smoke: a mint → register → test → call ORCL → success on Base Sepolia from a fresh ticker

Hermes tier is gated to "experimental — try at your own risk" and may simply route to `tools-lite` if it fails. Acceptable.

### 11.2 Phase 2 — finale stretch (target: Tuesday night)

- `HermesAgentRuntime.withManifest()` actually mounts the materialized dir
- `code-auditor` template at hermes tier: real audit on Base Sepolia from a permissionless mint
- Hermes-tier mints write back state hashes into receipts as the agent grows memory

If Phase 2 is shaky during rehearsal, kill-switch the hermes button on the launch UI and ship Phase 1. The demo arc as written above doesn't actually require Hermes.

### 11.3 Cut list (already-decided no-shows)

Things NOT in scope for either phase:
- 0G Storage *write* paths from operator runtime (only `image_gen` writes; everything else is read)
- Re-pinning manifest after edit (manifests are immutable — to "edit," mint a new agent)
- Per-tool authentication / access control beyond template whitelisting
- Anything in the contracts directory (no new contracts)

---

## 12 · Risk register and kill-switches

| Risk | Likelihood | Impact | Kill-switch |
|---|---|---|---|
| 0G Storage browser SDK has SSR/bundle issues in Next.js | Medium | High (mint flow blocked) | Wrap in a Next.js API route running the SDK in Node; browser POSTs raw manifest |
| 0G Storage indexer slow or down at demo time | Low–Medium | High | Operator falls back to manifest shadow stored in dynamic registry; demo continues with a small ⚠ badge "0G Storage degraded — using shadow" |
| Tool loop stalls (LLM goes in a loop calling `recall` forever) | Medium | Medium | Hard cap of 6 tool calls per task; abort with summary |
| `query_agent` tool fails for live-minted agent (unfunded wallet) | Medium | High (key demo moment) | Operator pre-funds dynamic-agent wallets with $1 USDC + 0.001 ETH on first inference attempt; non-blocking but logged |
| `image_gen` API down | Low | Low | Returns stub URL with note; demo does not use this template anyway |
| Hermes `withManifest` plumbing breaks the static trio | Low | Catastrophic | Phase 2 only; static trio's loading path stays untouched in Phase 1; tested before flipping the launch UI flag |
| Chain reorg between mint and register | Very low | Low | We already wait for confirmation in `useWaitForTransactionReceipt`; nothing new |

---

## 13 · Smoke tests

Run all of these against Base Sepolia + 0G Galileo before declaring rehearsal-ready:

1. **Pin/fetch round-trip.** `bun run scripts/og-storage-roundtrip.ts` — pin a sample manifest, fetch it back, assert equality.
2. **Mint with manifest.** Web flow: pick `data-oracle` template, mint, register. Assert: `metadataHash` on chain == `keccak256(canonical(manifest))`.
3. **First inference, tools-lite.** Hit `/x402/infer` for the new agent. Assert: tools list in the response transcript ⊆ the template's tools.
4. **Cross-agent call.** Pick `cross-agent-orchestrator`, mint, ask it "what's the price of ETH?", which should make it call `query_agent("oracles.slopstock.eth", ...)`. Assert: a real Base Sepolia USDC transfer tx from the new agent's wallet to ORCL's vault.
5. **Static trio unchanged.** Run an AUDIT call. Assert: receipt format identical to before, bundleHash identical to before. *(No regressions.)*
6. **Manifest tampering refused.** Submit register payload where the manifest doesn't match the on-chain `metadataHash`. Assert: 400.

If any of (1)–(5) fail, we don't push and we triage. If (6) fails, we still push — it's a defense-in-depth check, not a demo-blocker.

---

## 14 · Done criteria

**Phase 1 done** when (1)–(6) above pass and a non-Kilian person can mint an agent end-to-end in under 90 seconds on a fresh wallet.

**Phase 2 done** when a permissionless `code-auditor` mint can audit a sample contract end-to-end and the receipt's transcript shows ≥3 tool calls including `pattern_search`.

**Rehearsal-ready** = Phase 1 done plus the demo arc rehearsed twice in under 5 minutes.

**Finale-ready** = rehearsal-ready plus either Phase 2 done or Hermes tier hidden in the launch UI.

---

## Appendix A — file-touch budget

Estimated LOC delta:

```
packages/shared/src/templates.ts          + 320  (5 templates × patterns/skills bodies live here)
packages/shared/src/manifest.ts           +  90
packages/shared/src/og-storage.ts         +  60  (interface + factory)
packages/shared/src/og-storage-impl.ts    + 120  (real SDK calls)
apps/operator/src/store/dynamic-registry  +  30
apps/operator/src/http/server.ts          +  60
apps/operator/src/runtime/manifest-loader + 110
apps/operator/src/runtime/tools-lite.ts   +  90
apps/operator/src/runtime/hermes-loop.ts  +  20  (extract runAgentLoop)
apps/operator/src/runtime/hermes.ts       +  30  (withManifest)
apps/operator/src/runtime/index.ts        +  40
apps/operator/src/runtime/hermes-tools.ts + 240  (3 new tools)
apps/web/src/lib/og-storage.ts            +  60
apps/web/src/app/launch/launch-client.tsx + 220  -120 (redesign sections 02+04)
apps/web/src/lib/agents.ts                +  30
apps/web/src/app/agent/[ticker]/page.tsx  +  20
─────────────────────────────────────────────────
total                                     ~ 1500 net new
```

Aggressive but doable in 1.5 days by one engineer with Claude pair. The biggest risk is the 0G Storage SDK integration; everything else is straightforward TypeScript on patterns that already exist in this codebase.

## Appendix B — what we're NOT doing

So future-Kilian doesn't yak-shave:

- **No new contracts.** ERC-7857 already supports our manifest hash semantics. We're using the existing mint signature.
- **No registry contract changes.** Operator-side dynamic registry stays the source of truth. ENS subname registration for permissionless agents is a separate thread; not in this PRD.
- **No 0G Storage write paths from runtime** beyond `image_gen` results. Tool outputs that need to persist write to the operator's local sqlite via `note`.
- **No re-deploy of the static trio.** Their seed dirs continue to ship with the operator; the manifest path is the *new* path for *new* agents.
- **No mainnet anything.** Stays on Base Sepolia + 0G Galileo through finale.

---

*End of PRD.*
