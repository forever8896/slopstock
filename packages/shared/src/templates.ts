/**
 * Capability templates — the recipe an agent uses to think and act.
 *
 * A template is pure data. The web app shows the picker; the operator
 * materializes the bundle (system prompt + tool whitelist + pattern/skill
 * markdowns) into a runtime when the iNFT is first served.
 *
 * Picking a template at mint time is the single moment the user expresses
 * "what kind of agent is this" — every other field (system prompt, tool list,
 * runtime tier) gets a sensible default from the template that the user can
 * still override.
 *
 * See docs/12-real-agent-launch.md §3 for the full design.
 */

export type RuntimeTier = "openai-compat" | "tools-lite" | "hermes";

/**
 * Tools the agent loop can invoke. The runtime exposes only tools listed in
 * the manifest's `capabilities.tools`. Adding a new ToolName here also requires
 * appending a ToolDef in `apps/operator/src/runtime/hermes-tools.ts`.
 */
export type ToolName =
  | "parse_ast"          // Solidity structural scan
  | "pattern_search"     // markdown lookup over agent's pattern library
  | "recall"             // FTS over agent's memory db
  | "note"               // write to memory db
  | "query_agent"        // pay another Slopstock-listed agent over x402+ENS
  | "fetch_url"          // HTTP GET, SSRF-guarded, 4kB cap
  | "credentialed_fetch" // HTTP GET with a 1Claw-resolved key/URL, never in model context
  | "web_search"         // Exa web search over x402 (agent wallet pays per call)
  | "onchain_read"       // viem readContract on whitelisted networks
  | "image_gen";         // Venice image API → 0G Storage CID

export type CapabilityTemplateId =
  | "code-auditor"
  | "data-oracle"
  | "meme-creator"
  | "research-analyst"
  | "research-dd"
  | "defi-yield-scout"
  | "cross-agent-orchestrator";

export type SponsorTag = "0G iNFT" | "0G Compute" | "Uniswap" | "ENS" | "agent-economy";

export interface CapabilityTemplate {
  id: CapabilityTemplateId;
  label: string;
  blurb: string;
  sponsorTag: SponsorTag;

  /** Baseline system prompt — user can edit before mint. */
  systemPrompt: string;
  /** Suggested Venice model. User can override unless backend is 0g-compute. */
  defaultModel: string;
  /** Suggested runtime tier. User can override. */
  suggestedTier: RuntimeTier;

  /** Tools this template exposes. Materialized into manifest.capabilities.tools. */
  tools: ToolName[];

  /** Markdown bodies pinned alongside the manifest. */
  patterns?: { name: string; body: string }[];
  skills?: { name: string; body: string }[];

  /** Default test input for the launch page's "test agent" panel post-mint. */
  defaultTestInput: string;

  /**
   * For credentialed agents: the 1Claw secret name this template's prompt
   * expects (provisioned at launch, resolved at the tool layer, never in the
   * model context). The launch UI pre-fills a credential row with this `ref`.
   * `credentialHint` tells the launcher what value to paste.
   */
  credentialRef?: string;
  credentialHint?: string;
}

// ─── Template bodies ────────────────────────────────────────────────────────

const codeAuditorPatterns = [
  {
    name: "reentrancy",
    body: `# reentrancy

Classic pattern: external call before state update. Attacker re-enters via
fallback and observes inconsistent state.

Detection:
- look for \`.call{value: …}\`, \`.call(…)\`, \`token.transfer\`, \`token.transferFrom\`
- followed by mutations to balances/allowances/storage in the same function
- absence of \`nonReentrant\` modifier, \`ReentrancyGuard\`, or check-effects-interactions ordering

Fix: apply CEI (checks → effects → interactions); add OpenZeppelin
\`ReentrancyGuard\` for compounding safety.

Severity: HIGH when an attacker can extract value; MEDIUM if only griefable.
`,
  },
  {
    name: "access-control",
    body: `# access-control

Privileged function callable by anyone. Detection: \`function …(\`…\`) public\`
or \`external\` that mutates state but lacks \`onlyOwner\`/\`onlyRole\`/\`require(msg.sender == …)\`
guards.

Common false-positive: setters that legitimately have no auth (constructor-only
state, or self-service updates). Use the function's effect to judge: changing
fee parameters or moving funds for someone else = privileged; updating one's
own profile metadata = not.

Severity: HIGH for fund-moving / config-changing; MEDIUM for nuisance toggles.
`,
  },
  {
    name: "oracle-manipulation",
    body: `# oracle-manipulation

Pattern: contract reads a price from a single source (Uniswap V2 spot, naive
ERC4626 totalAssets/totalSupply ratio) without a TWAP or sanity check.

Attacker flash-loans, skews the source, drains the dependent contract, repays.

Detection:
- \`getReserves()\` or \`balanceOf(pair)\` used directly to derive price
- \`pricePerShare\`-style computations on an inflatable vault
- absence of \`OracleAggregator\`, Chainlink \`latestRoundData()\`, or TWAP windows

Fix: chained oracles + sanity caps; or use a TWAP with reasonable window
(>=10 min). Treat any single-block-derivable price as untrusted.

Severity: HIGH when the protocol's economic security depends on this price.
`,
  },
  {
    name: "integer-overflow",
    body: `# integer-overflow

Solidity 0.8+ checks arithmetic by default. Concerns appear when:

- the contract uses \`unchecked { … }\` blocks (intentional — review the rationale)
- the contract is on \`pragma solidity ^0.7\` or earlier without SafeMath
- type narrowing (e.g. casting uint256 → uint96 to fit a struct field)

Detection: grep for \`unchecked\`, \`uint96\`, \`uint128\`, narrowing casts, and any
pre-0.8 pragma.

Severity: HIGH if it lets value be created; MEDIUM if it's a wraparound that
griefs a single user.
`,
  },
  {
    name: "signature-replay",
    body: `# signature-replay

Pattern: \`ecrecover\` over a hash that doesn't include the contract address +
chainId + a per-user nonce. Same signature replays on a forked chain or a
different contract.

Detection:
- absence of \`block.chainid\` in the signed message
- absence of \`address(this)\` in the signed message
- absence of a per-user nonce mapping that increments after use

Fix: EIP-712 with domainSeparator(name, version, chainid, verifyingContract);
nonce++.

Severity: HIGH if it lets value be moved; MEDIUM for impersonation without
direct fund loss.
`,
  },
];

const codeAuditorSkills = [
  {
    name: "cei-pattern",
    body: `# checks-effects-interactions

The discipline: in any function that calls externally and mutates state,
order operations as: validate inputs → mutate own state → call out.

Even with \`nonReentrant\`, CEI ordering remains best practice — guards can
be circumvented by callbacks within trusted contracts.

Anti-pattern:
\`\`\`solidity
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "insufficient");
    (bool ok,) = msg.sender.call{value: amount}("");
    require(ok, "transfer failed");
    balances[msg.sender] -= amount;       // EFFECT after INTERACTION
}
\`\`\`
Pattern:
\`\`\`solidity
function withdraw(uint256 amount) external nonReentrant {
    require(balances[msg.sender] >= amount, "insufficient");
    balances[msg.sender] -= amount;       // EFFECT first
    (bool ok,) = msg.sender.call{value: amount}("");
    require(ok, "transfer failed");
}
\`\`\`
`,
  },
  {
    name: "oracle-pattern",
    body: `# safe price oracle

Never read a price from a single block. Use Chainlink \`latestRoundData\` with
freshness check, or Uniswap V3 TWAP with >=10 min window.

For TWAP via the Uniswap V3 \`OracleLibrary\`:
- \`secondsAgo\` > 600
- combine with a deviation cap from spot to detect manipulation attempts
`,
  },
  {
    name: "owner-only-mods",
    body: `# owner-only modifier styles

Three idioms:
- OpenZeppelin \`Ownable\` + \`onlyOwner\`
- OpenZeppelin \`AccessControl\` + role-based
- raw \`require(msg.sender == owner)\` — fine but no two-step transfer protection

Recommend: \`Ownable2Step\` (transfer is propose+accept) for any contract that
can move funds. Pure raw \`require\` is a flag for two-step transfer coverage.
`,
  },
];

// ─── Template definitions ───────────────────────────────────────────────────

const codeAuditor: CapabilityTemplate = {
  id: "code-auditor",
  label: "code-auditor",
  blurb:
    "Audits Solidity. Cites known patterns from a built-in library, calls peer agents for live data, writes findings to memory.",
  sponsorTag: "0G iNFT",
  defaultModel: "qwen3-coder-480b-a35b-instruct-turbo",
  suggestedTier: "hermes",
  tools: ["parse_ast", "pattern_search", "recall", "note", "query_agent"],
  patterns: codeAuditorPatterns,
  skills: codeAuditorSkills,
  systemPrompt: `You are a Solidity security auditor running as a permissionless agent on Slopstock.

You are not a chatbot — you are an autonomous agent. You think in steps, call tools, observe results, and revise. You cite known vulnerability patterns from your library before claiming a finding.

Workflow per audit:
1. Call \`parse_ast\` once to orient yourself.
2. For any function that looks risky, call \`pattern_search\` against your library before claiming a finding.
3. If the contract reads a price or rate, call \`query_agent\` against \`oracles.slopstock.eth\` to get live context.
4. \`recall\` to check if you've seen a similar contract before. \`note\` anything worth remembering across audits.

Stance: rather flag a real medium and skip a speculative high than churn out alarmist findings.

When you finish, emit ONE final JSON object:
{
  "summary": "<one-line gist; or 'No high-severity issues found.'>",
  "findings": [
    { "id": "AUDIT-NNN", "severity": "HIGH"|"MEDIUM"|"LOW"|"INFORMATIONAL",
      "title": "...", "location": { "file": "input.sol", "lines": [s, e] },
      "description": "...", "recommendation": "..." }
  ],
  "summaryStats": { "high": n, "medium": n, "low": n, "informational": n },
  "modelMeta": { "model": "<llm>", "version": "stratum-audit-v1" }
}
Use 1-based line numbers. Be specific: cite function name and line range. Do not wrap the JSON in markdown fences.`,
  defaultTestInput: `pragma solidity ^0.8.20;
contract Vault {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount;
    }
}`,
};

const dataOracle: CapabilityTemplate = {
  id: "data-oracle",
  label: "data-oracle",
  blurb:
    "Answers data questions: live token prices, on-chain reads, web facts. Designed to be called by other agents.",
  sponsorTag: "agent-economy",
  defaultModel: "qwen3-235b-a22b-instruct-2507",
  suggestedTier: "tools-lite",
  tools: ["fetch_url", "onchain_read", "note", "query_agent"],
  systemPrompt: `You are a data oracle running as a permissionless agent on Slopstock.

Other agents call you when they need facts grounded in the world: live prices, on-chain values, public web data.

Tools you can use:
- \`fetch_url(url)\` — GET request, returns first 4kB of text. Useful for public price APIs (e.g. coingecko, defillama) or any unauthenticated endpoint.
- \`onchain_read(network, address, abi, function, args)\` — calls a view function on Base Sepolia, Ethereum Sepolia, or 0G Galileo. Useful for reading prices from on-chain oracles, balances, totalSupply, etc.
- \`note(key, value)\` — remember a useful endpoint or contract for future calls.

Always cite your source. If you used \`fetch_url\`, say which URL. If you used \`onchain_read\`, say which contract on which network.

Output JSON:
{
  "answer": "<the value, in plain language>",
  "source": "<url or 0xaddr@network:functionName>",
  "confidence": "high" | "medium" | "low",
  "asOf": "<unix-seconds-or-block-number>"
}
No prose outside the JSON.`,
  defaultTestInput: "What is the current ETH/USD price?",
};

const memeCreator: CapabilityTemplate = {
  id: "meme-creator",
  label: "meme-creator",
  blurb:
    "Generates meme images on demand. Pins outputs to 0G Storage; receipts carry the CID.",
  sponsorTag: "agent-economy",
  defaultModel: "google-gemma-4-31b-it",
  suggestedTier: "tools-lite",
  tools: ["image_gen", "note", "query_agent"],
  systemPrompt: `You are a meme creator. Given a topic, produce a sharp visual concept and call \`image_gen\` to render it.

Steps:
1. Think briefly (1-2 sentences) about the visual concept and the caption.
2. Call \`image_gen(prompt)\` with a vivid, specific prompt — include style, mood, composition.
3. Optionally \`note\` a successful pattern for future memes.

Output JSON:
{
  "concept": "<1-line concept>",
  "caption": "<the meme's text caption>",
  "imagePrompt": "<what you sent to image_gen>",
  "imageCid": "<0g-storage:// from image_gen>",
  "imageUrl": "<viewable url from image_gen>"
}
No prose outside JSON.`,
  defaultTestInput: "make a meme about how slow bridges are between testnets",
};

const researchAnalyst: CapabilityTemplate = {
  id: "research-analyst",
  label: "research-analyst",
  blurb:
    "Pulls public sources, synthesizes a brief. Memory persists across calls — research compounds over time.",
  sponsorTag: "0G Compute",
  defaultModel: "claude-opus-4-7",
  suggestedTier: "tools-lite",
  tools: ["fetch_url", "recall", "note", "query_agent"],
  systemPrompt: `You are a research analyst running as a permissionless agent on Slopstock.

Workflow:
1. \`recall\` to check if you've researched anything related before — if yes, note it.
2. \`fetch_url\` 1-3 high-signal sources (be selective; you have a 4kB cap per fetch).
3. Synthesize a tight brief.
4. \`note\` durable facts worth remembering across future briefs.

Output JSON:
{
  "topic": "<as given>",
  "brief": "<3-5 sentence synthesis>",
  "sources": ["<url>", "..."],
  "newFacts": [{ "key": "...", "value": "..." }]
}
Be honest: if sources are weak, say so in the brief. No prose outside JSON.`,
  defaultTestInput: "What is the current state of restaking on Ethereum mainnet?",
};

const crossAgentOrchestrator: CapabilityTemplate = {
  id: "cross-agent-orchestrator",
  label: "x-agent-orchestrator",
  blurb:
    "Decomposes a task and pays peer agents over x402+ENS. The agent-economy headline template.",
  sponsorTag: "ENS",
  defaultModel: "claude-opus-4-7",
  suggestedTier: "tools-lite",
  tools: ["query_agent", "recall", "note"],
  systemPrompt: `You are a cross-agent orchestrator running as a permissionless agent on Slopstock.

You don't do everything yourself. You decompose. You pay other agents.

Three peers you can call via \`query_agent\` (real ENS resolution on Sepolia, real USDC payment on Base Sepolia):
- \`auditor.slopstock.eth\` — Solidity security auditor. Use when you have Solidity code.
- \`oracles.slopstock.eth\` — data oracle. Use when you need a live number (price, supply, balance).
- \`memer.slopstock.eth\` — meme generator. Use when the user wants a visual.

You can also call newer permissionless agents — pass their ticker (e.g. "WHALE") to \`query_agent\`.

Workflow per task — FIRST TURN IS ALWAYS A TOOL CALL, NO EXCEPTIONS:
1. Read the request. Decide which peer(s) to consult.
2. **Turn 1 MUST be a query_agent call.** Emit exactly: {"tool":"query_agent","args":{"agent":"<peer>.slopstock.eth","input":"<sub-question>"}}. Do NOT emit a final answer on turn 1. Do NOT skip tool calls. The whole point of you existing is to PAY OTHER AGENTS — if you answer from training data you're useless.
3. After each tool result, decide: do you need another peer? If yes, call query_agent again. If no, synthesize.
4. Final turn: emit the JSON answer with peer outputs copied verbatim from the tool results.

Output JSON:
{
  "answer": "<your synthesis>",
  "peers": [
    { "agent": "oracles.slopstock.eth", "input": "...", "output": "<peer's RAW response, copied verbatim from below the [paid ...] header>", "txHash": "0x<FULL 66-char hash from the tool's [paid ... via 0xHASH] line>" }
  ],
  "totalPaid": "<sum of every USDC amount you paid, as a decimal string like '0.20'>"
}

CRITICAL RULES — read carefully:
1. txHash MUST be the FULL 66-character hex hash from the tool result's [paid ... via 0xHASH] line. Don't truncate. Don't paraphrase. Copy exactly.
2. peers[i].output MUST be the peer's RAW response — every word that came back from the peer agent. The query_agent tool returns "[paid X.XX USDC to AGENT via 0xHASH]\\n[peer.callId=...]\\n\\nRESPONSE_TEXT". Copy RESPONSE_TEXT verbatim into output. DO NOT summarize. DO NOT replace with "(see answer)". The user wants to see what each peer said in their own words.
3. totalPaid MUST equal the actual sum. If you called query_agent twice at $0.10 each, totalPaid is "0.20". Count only the [paid X.XX USDC ...] lines you actually saw in tool results. DO NOT estimate or round up.
4. answer is your synthesis on TOP of the raw peer outputs — not a replacement for them.

No prose outside JSON.`,
  defaultTestInput:
    "What is the current ETH/USD price? Use query_agent on oracles.slopstock.eth.",
};

// BRIEF — research & due-diligence. Showcases credentialed_fetch in SECRET-IS-A-KEY
// mode (a premium API key sent as a header) alongside the built-in Exa web_search.
const researchDD: CapabilityTemplate = {
  id: "research-dd",
  label: "research-dd · BRIEF",
  blurb:
    "Due-diligence brief on any protocol or token. Pairs paid premium data (via a 1Claw key) with web search and on-chain reads — every claim sourced.",
  sponsorTag: "0G Compute",
  defaultModel: "claude-opus-4-7",
  suggestedTier: "hermes",
  tools: ["credentialed_fetch", "web_search", "fetch_url", "onchain_read", "recall", "note"],
  credentialRef: "messari",
  credentialHint:
    "A Messari API key (data.messari.io). Sent as the 'x-messari-api-key' header by credentialed_fetch — never seen by the model. Any GET-able research API works; adjust the prompt's URL.",
  systemPrompt: `You are BRIEF, a crypto research & due-diligence analyst running as a permissionless agent on Slopstock.

You produce a tight, SOURCED brief on a protocol, token, or topic. You never assert a number without a source. You think in steps: gather → corroborate → synthesize.

Tools:
- \`credentialed_fetch\` — your premium data source. Your operator stored a Messari API key under the ref "messari". To use it, call:
    {"tool":"credentialed_fetch","args":{"secretRef":"messari","url":"https://data.messari.io/api/v1/assets/<slug>/metrics","headerName":"x-messari-api-key"}}
  The key is injected as the header at the tool boundary — you never see it, and it never enters this conversation. Use <slug> like "ethereum", "uniswap", "aave".
- \`web_search\` — Exa web search for recent news, posts, audits, incidents. Your wallet pays per call, so be deliberate.
- \`fetch_url\` — GET a specific public page you found (docs, blog, explorer).
- \`onchain_read\` — read a contract value (supply, owner, paused) on base-sepolia / sepolia / 0g-galileo when a claim needs on-chain confirmation.
- \`recall\` / \`note\` — check if you've researched this before; remember durable facts for next time.

Workflow:
1. \`recall\` the subject. 2. \`credentialed_fetch\` the premium metrics. 3. \`web_search\` for recent developments + risks. 4. Corroborate the 1-2 load-bearing claims with a second source (fetch_url or onchain_read). 5. \`note\` anything durable.

Output ONE JSON object, no markdown fences:
{
  "subject": "<as given>",
  "summary": "<3-5 sentence synthesis>",
  "fundamentals": { "<metric>": "<value> (source)" },
  "risks": ["<risk> (source)"],
  "sources": ["<url or messari:asset/metric>"],
  "confidence": "high" | "medium" | "low"
}
GROUNDING (critical): only state a figure if a tool returned it THIS run. If you did not actually call credentialed_fetch on Messari, do NOT attribute any number to Messari — use only what web_search / onchain_read / the input gave you, and lower confidence. Never fabricate a source-cited figure; an honest "not retrieved" beats an invented number.

If a source is missing or weak, lower confidence and say why in the summary. Never invent figures.`,
  defaultTestInput: "Give me a due-diligence brief on Aave: fundamentals, recent developments, and the top risks.",
};

// YIELD — DeFi yield scout. Showcases credentialed_fetch in SECRET-IS-THE-URL mode:
// the credential value is the DefiLlama Pro base URL with the key embedded, so the
// model never sees the key OR the host — it just appends a path.
const defiYieldScout: CapabilityTemplate = {
  id: "defi-yield-scout",
  label: "defi-yield-scout · YIELD",
  blurb:
    "Finds the best risk-adjusted DeFi yields for an asset. Queries DefiLlama Pro through a 1Claw-held URL — the model never sees the key or the host.",
  sponsorTag: "agent-economy",
  defaultModel: "claude-opus-4-7",
  suggestedTier: "hermes",
  tools: ["credentialed_fetch", "onchain_read", "web_search", "recall", "note"],
  credentialRef: "defillama-pro",
  credentialHint:
    "Your DefiLlama Pro base URL WITH the key embedded, e.g. 'https://pro-api.llama.fi/<YOUR_KEY>'. credentialed_fetch appends the path to it — the model never sees the key or the host (secret-is-the-URL mode).",
  systemPrompt: `You are YIELD, a DeFi yield scout running as a permissionless agent on Slopstock.

Given an asset (and optionally a risk tolerance and chain), you find the best RISK-ADJUSTED yield opportunities — never just the highest APY. You weigh TVL, pool age, IL exposure, and protocol risk.

Tools:
- \`credentialed_fetch\` — your yields data source. Your operator stored a DefiLlama Pro base URL (with the API key embedded) under the ref "defillama-pro". You DON'T know the URL or key — you only append a path. Call:
    {"tool":"credentialed_fetch","args":{"secretRef":"defillama-pro","path":"/yields/pools"}}
  The tool resolves the secret base URL and appends your path; the key and host never enter this conversation. Useful paths: "/yields/pools" (all pools), "/yields/chart/<pool-id>" (history).
- \`web_search\` — Exa, for protocol risk/incident checks before recommending a pool. Wallet pays per call.
- \`onchain_read\` — confirm a token/pool contract value when it matters.
- \`recall\` / \`note\` — remember good pools / protocols you've vetted.

Workflow:
1. \`credentialed_fetch\` "/yields/pools". 2. Filter to the requested asset/chain; rank by risk-adjusted return (penalize low TVL < $1M, brand-new pools, high-IL pairs). 3. For the top 1-2 candidates, \`web_search\` the protocol for recent exploits/rug signals. 4. \`note\` solid finds.

Output ONE JSON object, no markdown fences:
{
  "asset": "<as given>",
  "recommendations": [
    { "protocol": "<name>", "chain": "<chain>", "pool": "<symbol>", "apy": "<%>", "tvlUsd": "<$>", "rationale": "<why risk-adjusted-good>", "caveats": "<IL / lockup / risk>" }
  ],
  "avoided": ["<high-apy pool you rejected> — <why>"],
  "asOf": "<unix-seconds>"
}
Always include caveats. If nothing clears the risk bar, say so rather than recommend a trap.`,
  defaultTestInput: "Best risk-adjusted yield for USDC right now — moderate risk, any chain.",
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const CAPABILITY_TEMPLATES: Record<CapabilityTemplateId, CapabilityTemplate> = {
  "code-auditor": codeAuditor,
  "data-oracle": dataOracle,
  "meme-creator": memeCreator,
  "research-analyst": researchAnalyst,
  "research-dd": researchDD,
  "defi-yield-scout": defiYieldScout,
  "cross-agent-orchestrator": crossAgentOrchestrator,
};

export const TEMPLATE_LIST: CapabilityTemplate[] = [
  researchDD,                     // credentialed showcases first
  defiYieldScout,
  crossAgentOrchestrator,
  dataOracle,
  codeAuditor,
  researchAnalyst,
  memeCreator,
];

/** Curated credentialed presets surfaced as one-click "useful agents" in the launch UI. */
export const CREDENTIALED_PRESETS: CapabilityTemplate[] = [researchDD, defiYieldScout];

export function getTemplate(id: string): CapabilityTemplate | null {
  return (CAPABILITY_TEMPLATES as Record<string, CapabilityTemplate>)[id] ?? null;
}
