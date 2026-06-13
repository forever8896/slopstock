# 10 — Demo-Script Agent (first consumer agent)

> **Why it matters at the venue:** every hacker at ETHGlobal NYC has a GitHub repo and
> 36 hours left to write a demo script. They don't know our judging rubric, our sponsor
> lineup, or how to angle their story for maximum points. We do. This agent turns that
> asymmetry into revenue: **pay Slopstock, get a crisp 90-second demo script with
> bounty-specific callouts tailored to your actual code.**
>
> It is also the load-bearing proof of the Slopstock platform thesis: a real x402-paid
> agent producing real value for a real stranger in the room.

## Why it's non-cosmetic

Shipping a "demo-script" LLM prompt wrapped in a toy endpoint would cost nothing and
prove nothing. The non-cosmetic requirements are:

1. **It reads your repo, not a description of your repo.** The agent fetches the actual
   tree structure and follows up with `read_file` tool calls on the files that matter
   (README, entry points, key contracts, package.json). The output is specific to your
   code, not a generic hackathon script template.
2. **It knows the judging environment — grounded in real data, not vibes.** The agent
   queries the **ethglobal-skills API** ([data backbone](#data-backbone-ethglobal-skills-x402-api))
   live for the actual sponsor bounty text and the **17,643 past projects + every finalist
   and bounty winner** of the last six years, then layers our hand-curated *frame* (what
   "overall impression" actually weighs, what most demos get wrong in the first 30s) on
   top. The moat is the combination: a public LLM has neither the live bounty corpus nor
   our synthesis of what wins. Grounding in finalist patterns also kills hallucinated
   advice — every callout can cite a real precedent.
3. **It runs on 0G Compute TEE.** The inference is on-chain (verifiable, paid per call),
   not a free API wrapper. The receipt lands on Walrus ([03](03-walrus.md)). This is the
   demo we run to show our own platform is using itself.

## Architecture: hybrid deterministic + agentic

```
caller (x402 HTTP)
  └─ POST /run/demo-script
       { github_url, bounties?, vibe? }

operator
  ├─ 1. deterministic repo-digest (no LLM yet)
  │       ── fetch tree via GitHub API (no auth needed for public repos)
  │       ── filter: README*, package.json, *.sol, main entry points, key config
  │       ── build a compact digest: file list + snippet excerpts (< 8K tokens)
  │       ── inject into initial system message context
  │
  └─ 2. 0G Compute TEE inference  (deepseek-v3 @ 0x1B3AAef3…)
           tools: [ read_file(path),                ← proven in smoke-0g-tool-calling.ts
                    fetch_bounties(event, sponsor),  ← ethglobal-skills x402 API
                    search_winners(keyword, event) ] ← ethglobal-skills x402 API
           system_prompt: <judging-frame block> + digest
           user_prompt: "write a 90-second demo script for this project"
           ── model emits read_file to drill into the repo
           ── model emits fetch_bounties/search_winners to ground callouts in live data
           ──   operator pays ethglobal-skills via x402 (Base mainnet) past the free tier
           ── model produces final script (structured: hook / live demo beats / bounty callouts / close)
```

### Data backbone: ethglobal-skills x402 API

The factual half of the moat is **not** hand-typed — it's pulled live from
`https://ethglobalskills.vercel.app` (the `ethglobal-skills/repo` project):

| Endpoint | Use in this agent |
|---|---|
| `GET /api/sponsors?keyword=` | enumerate the event's sponsors |
| `GET /api/prizes?event=&sponsor=` | the **actual bounty text + qualifications** to angle callouts against |
| `GET /api/projects?event=&keyword=&prize=&include=&limit=` | finalist/winner precedents to ground "what wins" advice |

**It is itself an x402 API**: 10 free requests/minute, then *(per its docs)* `HTTP 402 →
$0.05 USDC on Base mainnet per request`. In principle we'd pay it with our own x402 v2
outbound leg ([05](05-x402-v2.md)) for a "pay a real third-party at the venue" beat.

> ⚠️ **Verified 2026-06-13 — their paid path is currently broken.** Past the free tier the
> API returns `HTTP 500 / MIDDLEWARE_INVOCATION_FAILED` (Vercel), **not** a 402 challenge,
> so there is nothing for our x402 client to satisfy. **Do not depend on paying
> ethglobal-skills for the payment-triangle headline** — that story stays with **Exa**
> (proven outbound counterparty, [05](05-x402-v2.md)). Treat ethglobal-skills as a
> **free-tier data source**: cache hard, stay ≤10 req/min, soft-fail to the frame on any
> non-200. If they fix the middleware before judging, the "pay them live" beat is a bonus
> (also needs Base-mainnet USDC — we currently hold only Base-Sepolia TestnetUSDC).

The split is intentional:

- The **deterministic digest** never fails silently: if the GitHub URL is broken or
  private the call rejects fast before spending inference budget.
- The **tool-calling loop** lets the model drill into files it actually needs without
  blowing the context window on every file. The `read_file` tool calling path was proven
  end-to-end on 0G Compute mainnet provider `0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0`
  (deepseek-v3) via `apps/operator/scripts/smoke-0g-tool-calling.ts`: the model emitted
  `read_file({"path":"README.md"})` on first invocation without hints.

### Brain: deepseek-v3 on 0G Compute, deepseek-v4 upgrade path

Current funded sub-account covers provider `0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0`
(deepseek-v3-0324). Provider `0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB` is deepseek-v4-pro
— higher quality, same interface. Upgrading is a one-line swap of the provider address
**once sub-account is funded** (tracked in [00](00-state-and-funding.md)).

### Inputs

| Field | Required | Notes |
|---|---|---|
| `github_url` | ✅ yes | public repo or tree URL; branch/tag/SHA optional |
| `bounties` | optional | e.g. `"ENS, Walrus, Dynamic"` — agent callouts specific bounty scoring angles |
| `vibe` | optional | `"technical"` / `"punchy"` / `"chaotic"` — tone latitude proven via `smoke-0g-tone-test.ts` |

### Moat: live data × our judging frame

The moat is the **product** of two things, neither sufficient alone:

1. **Live factual corpus (ethglobal-skills API).** Real sponsor bounty text + 17,643
   projects + every finalist/winner. Always current, impossible to reproduce by prompting
   a bare LLM. Fetched at runtime via the `fetch_bounties`/`search_winners` tools above.
2. **Our judging frame (hand-authored).** The synthesis a data dump can't give you:
   - what "overall impression" actually weighs vs. the listed categories (first-hand)
   - which bounty criteria are checkboxes vs. true differentiators
   - demo-script anti-patterns — what most presentations get wrong in the first 30s
   - the 90-second structure template (hook → live demo beats → bounty callout → close)

The frame is hand-authored in `packages/shared/src/agents/demo-script/system-prompt.ts`
and loaded into the Hermes system message; it instructs the model to *back every callout
with a real bounty/winner pulled from the API*. **The moat is frame-applied-to-live-data,
not a static text block** — a competitor copying our prompt still lacks the data feed, and
a competitor with the data feed still lacks our frame.

### Output format

```
## Hook (0–10s)
One sentence. What problem, for whom, right now.

## Live demo beats (10–70s)
Beat 1 — [screen/action]: ...
Beat 2 — [screen/action]: ...
Beat 3 — [screen/action]: ...

## Bounty callouts (70–80s)
[BOUNTYNAME]: one sentence on why this qualifies + what to say at the booth.

## Close (80–90s)
The ask. What you want the judge to remember.

---
_Generated by Slopstock demo-script agent · receipt: <walrus-blobId>_
```

## Tech decisions (from research)

- **GitHub REST API, unauthenticated.** `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`
  returns the full tree JSON; rate limit is 60 req/hr unauthenticated, 5000 with a token.
  Fine for a venue demo (add `GITHUB_TOKEN` env var as optional bypass). File content via
  `GET /repos/{owner}/{repo}/contents/{path}` (base64 body, < 1 MB per file).
- **Tool-calling loop: max 5 rounds.** The smoke test proves one round; production caps
  at 5 to bound latency and cost. If the model hasn't finished in 5 rounds, return best
  effort with a note.
- **Context budget: ~12K tokens.** Digest (4K) + system prompt with knowledge block (4K)
  + tool round-trips (4K headroom). deepseek-v3 context window is 32K — no pressure.
- **x402 pricing: 2.00 USDC per run.** COGS ≈ ~$0.003 (deepseek-v3 at 0G compute rates
  for ~3K tokens). Margin is the point — this is the revenue-from-strangers demo.
- **ethglobal-skills via x402 (core, not stretch).** Base URL `https://ethglobalskills.vercel.app`.
  10 free req/min then 402 → $0.05 USDC on Base mainnet. Pay it through our existing
  `x402-fetch` client ([05](05-x402-v2.md)) — the 402 challenge is standard. Cache responses
  per `(event, sponsor)` for the session to stay inside the free tier where possible. Respect
  the `X-Skill-Version` header (log a warning if a newer version ships mid-event).
- **Exa for open-web supplementation (stretch).** If Exa is live via x402, the agent can
  fetch anything ethglobal-skills doesn't cover. Optional; ethglobal-skills + the frame
  cover the base case without it.
- **Receipt pinning on Walrus** ([03](03-walrus.md)). Every run generates a receipt;
  blobId is included in the output footer. This ties the revenue event to the decentralized
  tape — the demo-within-the-demo.

## Build steps (TDD)

All tests in `apps/operator/src/agents/demo-script/`.

### Step 1 — GitHub digest module
`apps/operator/src/agents/demo-script/repo-digest.ts`

```ts
// Signature (tests drive this shape)
export async function digestRepo(githubUrl: string): Promise<RepoDigest>
// RepoDigest: { owner, repo, sha, tree: FileEntry[], excerpts: { path, snippet }[] }
```

Tests:
- `digestRepo("https://github.com/forever8896/slopstock")` returns a tree with > 5 entries.
- Files matching `README*`, `package.json`, `*.sol`, `**/index.ts` are included in
  excerpts; binary blobs (`*.png`, `*.lock`) are excluded.
- Total digest token estimate (rough: chars/4) is < 4096 tokens.
- Invalid URL or 404 repo throws `RepoNotFoundError` before any LLM call.
- Private repo (403) throws `RepoPrivateError` with a user-friendly message.

### Step 2 — read_file tool handler
`apps/operator/src/agents/demo-script/tools.ts`

```ts
export const READ_FILE_TOOL = { /* OpenAI tool definition */ }
export async function handleReadFile(owner: string, repo: string, path: string, ref: string): Promise<string>
```

Tests:
- Fetches a known file from a public repo, returns decoded string content.
- Path with leading `/` is normalised to relative.
- File > 100KB is truncated to 100KB with a `[truncated]` suffix.
- Non-existent path returns `"[file not found: <path>]"` (soft error — model recovers).

### Step 2b — ethglobal-skills tools (x402-paid)
`apps/operator/src/agents/demo-script/ethglobal-skills.ts`

```ts
export const FETCH_BOUNTIES_TOOL = { /* tool def: (event, sponsor) */ }
export const SEARCH_WINNERS_TOOL = { /* tool def: (keyword, event, limit) */ }
export async function fetchBounties(event: string, sponsor?: string): Promise<Bounty[]>
export async function searchWinners(keyword: string, event?: string, limit?: number): Promise<ProjectRecord[]>
// both go through the x402-fetch client; pay only when the API answers 402
```

Tests:
- `fetchBounties("ETHGlobal NYC 2026", "ENS")` returns bounty records with
  `title`/`description`/`qualifications` fields.
- A 402 response triggers the x402 payment path and the retried request succeeds (integration
  test against the live API; assert a real Base tx/settlement occurred — ties to [05](05-x402-v2.md)).
- Session cache: a repeat `(event, sponsor)` within the run does not issue a second HTTP call.
- API down / network error returns `[]` (soft fail — agent falls back to the frame alone,
  never crashes the run).

### Step 3 — 0G inference loop
`apps/operator/src/agents/demo-script/run.ts`

```ts
export async function runDemoScript(input: DemoScriptInput): Promise<DemoScriptResult>
// DemoScriptInput: { githubUrl, bounties?, vibe? }
// DemoScriptResult: { script: string, toolCallsUsed: number, inputTokens: number, outputTokens: number }
```

Tests (use the real 0G mainnet provider — these are integration tests, same pattern as
`smoke-0g-tool-calling.ts`):
- End-to-end: `runDemoScript({ githubUrl: "https://github.com/forever8896/slopstock" })`
  returns a string containing "## Hook" and "## Close".
- With `bounties: "Walrus"`, output contains the word "Walrus" in the callouts section.
- With `vibe: "punchy"`, output tone is noticeably different (manual assertion in test
  comment — automated tone-assert is fragile; just confirm it doesn't crash).
- Tool-call loop terminates: if model never emits `tool_use`, returns after 1 round.
- Tool-call loop caps at 5 rounds regardless of model continuation.

### Step 4 — Hermes agent wiring
- Register `demo-script` agent in `apps/operator/src/agents/registry.ts` (or equivalent).
- System prompt + tool definitions injected via Hermes `runTask` path.
- x402 price header: `X-Payment-Required: 2.00 USDC`.
- Receipt generated on task completion, pinned to Walrus.

Tests:
- `POST /run/demo-script` with a valid GitHub URL + an x402 payment returns 200 with a
  valid demo script body.
- `POST /run/demo-script` without payment returns 402 with x402 challenge headers.
- `POST /run/demo-script` with a bad GitHub URL returns 400 before LLM call (confirm: no
  0G credits consumed).

### Step 5 — Web UI listing
- Agent card on the platform: price badge (2.00 USDC), "What it does" 2-liner, input
  form (GitHub URL, bounties, vibe).
- Connects to the `deprecated: false` flag convention in `apps/web/src/lib/agent-metadata.ts`.

## Acceptance criteria / THE DEMO

The demo is: walk a judge up to a laptop, hand them a URL to one of their own projects
or the Slopstock repo itself, run the agent, pay 2 USDC, get a script back in under
60 seconds.

- [ ] `POST /run/demo-script { github_url: "https://github.com/forever8896/slopstock" }` returns a
      complete, structured script within 60 s (wall clock).
- [ ] Script contains at least one sponsor-specific callout that names a real NYC 2026 bounty
      **fetched live from ethglobal-skills** (not from the static frame) — verifiable in logs.
- [ ] Payment-triangle beat demonstrable on one screen via **Exa** (proven outbound x402
      counterparty) alongside our own inbound payment. *(Paying ethglobal-skills is a bonus
      only if they fix their 500 paywall AND we have Base-mainnet USDC — not required.)*
- [ ] Receipt blobId is in the footer and resolves on the Walrus testnet aggregator.
- [ ] Payment path: caller pays 2.00 USDC via x402; Slopstock operator wallet receives it;
      ledger entry visible in the web P&L panel ([06](06-revenue-and-economics.md)).
- [ ] `vibe: "punchy"` produces noticeably punchier output than default (manual check).
- [ ] Tool-call loop fires: at least one `read_file` call appears in the operator logs for
      a repo where README is not in the initial digest.
- [ ] Upgrade path validated: swapping the provider constant to
      `0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB` (deepseek-v4-pro) and running a dry
      call succeeds once the sub-account is funded.

## Sibling agents (future scope, not this weekend)

The demo-script agent is deliberately the *simplest* consumer agent in a family. Do not
scope-creep these in — write them as separate plan docs if funded.

| Agent | What it does | Key dependency |
|---|---|---|
| **bounty-fit** | Given a repo URL + sponsor list, score/rank which bounties the project qualifies for and why. | Same digest + knowledge block; add bounty criteria corpus. |
| **submission-checker** | Check that a Devfolio submission is complete, has a working demo link, and isn't missing required fields. | Devfolio API or scraping. |
| **integration-recipe** | Given "I want to integrate Walrus" + repo URL, output the exact code changes needed. | Per-sponsor SDK knowledge; requires reading more files. |

## Stop-losses

- **GitHub rate limit (60/hr unauthenticated):** add `GITHUB_TOKEN` env var and inject in
  the digest HTTP calls — one token lifts to 5000/hr. Do this before the venue opens.
- **Tool-call loop hangs:** 0G provider does not always return `finish_reason: stop` cleanly.
  Cap at 5 rounds AND set a 45 s wall-clock timeout on the entire `runDemoScript` call;
  return best-effort output with a `[timed out after N rounds]` note.
- **System prompt knowledge block is stale:** the moat is only as good as its currency.
  Write the block the night before submissions close (Friday night / Saturday morning),
  once the sponsor list is confirmed.
- **deepseek-v3 sub-account runs dry at the venue:** have the operator wallet top-up
  script ([00](00-state-and-funding.md)) ready; keep 10 USDC headroom. At 2.00 USDC
  revenue / 0.003 USDC cost per run, the agent is essentially self-funding.
- **Scope creep to sibling agents:** resist. Ship demo-script working and revenue-
  generating first. Sibling agents are their own plan docs.

## Resources

- GitHub REST API tree: `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`
- GitHub contents: `GET /repos/{owner}/{repo}/contents/{path}`
- **ethglobal-skills API**: `https://ethglobalskills.vercel.app` — `GET /api/sponsors?keyword=`,
  `GET /api/prizes?event=&sponsor=`, `GET /api/projects?event=&keyword=&sponsor=&prize=&pool=&include=&limit=`
  (10 free/min, then x402 $0.05 USDC on Base). Repo + SKILL.md: https://github.com/ethglobal-skills/repo
- 0G Compute tool-calling proof: `apps/operator/scripts/smoke-0g-tool-calling.ts`
- 0G Compute tone proof: `apps/operator/scripts/smoke-0g-tone-test.ts`
- Deepseek-v3 provider: `0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0`
- Deepseek-v4-pro provider: `0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB`
- Walrus receipt pinning: [03](03-walrus.md)
- x402 payment rails: [05](05-x402-v2.md)
- Revenue / P&L: [06](06-revenue-and-economics.md)
- Agent secrets (Exa x402-native, no key needed): [09](09-agent-secrets.md)
