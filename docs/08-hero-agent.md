# 08 — Hero Agent

## 1. Why the hero agent matters

The cryptographic primitives are the project. But the demo needs **one believable productive agent** that:

- Has a real, demoable use case (judges grok in 5 seconds).
- Has a plausible "you don't want this leaked" story (so sealed weights are load-bearing, not theatrical).
- Is buildable in < 8 hours by 1 person while the rest of the team builds the framework.
- Produces structured, verifiable outputs (so attestations and dividends feel real).

## 2. Candidates considered

| Candidate | Pros | Cons | Verdict |
|---|---|---|---|
| **Toy trading-signals agent** | "Alpha leak" narrative perfect | We can't actually train profitable alpha in 8h; demo would be hollow | Skip |
| **Sealed Solidity audit agent (auditor)** | Real $20-50k human market; clean structured output; LoRA-trainable on disclosed audit reports; judges include security people who get it | Need a Solidity test corpus | **Pick (recommended)** |
| **Sealed RAG over a research firm corpus** | Clean "pay-per-query" story; minimal training | Need a real corpus we have rights to; harder to demo "the answer was good" | Backup |
| **Sealed image-gen LoRA** | Visual demo | LoRAs leak constantly in practice, undermining the "sealed weights" pitch | Skip |
| **Sealed voice clone** | Viral | Ethical risk for judges | Skip |
| **Sealed code-completion agent** | Generic but functional | Codeium/Copilot did this — judges will yawn | Skip |

**Choice:** **Sealed Solidity audit agent** — name `auditor`, ticker `AUDIT`, ENS `auditor.stratum.eth`.

## 3. Why the audit agent is right for this hackathon

- **Plausible economics:** Real Solidity auditors charge $200-1000/hr. An agent at $1/call is a 1000x cost reduction. Judges immediately grok the unit economics.
- **Real "leak risk":** if the agent's prompt template, fine-tune, and audit-corpus leak, the operator's edge is gone. ERC-7857 sealing actually solves this.
- **Verifiability:** outputs are structured findings (severity, location, fix). Judges can read an audit and say "yes that's a real bug." Hard to fake.
- **Small training data needed:** there are public datasets of audited contracts (Code4rena, Sherlock, Cantina) — we can train a small LoRA in ~2-3h.
- **Self-marketing:** *every other hackathon team* is shipping a contract. A demo where the audit agent finds a real bug in their contract is gold.

## 4. Tech spec

### 4.1 Model

- **Base:** `qwen2.5-coder-32b` (already available on 0G Compute per the research dive — confirm Hour 0)
- **LoRA:** trained on Code4rena reports (high-quality, structured, public)
- **System prompt:** 1-2k tokens, structured output schema baked in
- **Optional RAG:** corpus of known vulnerability patterns + EIPs

If `qwen2.5-coder-32b` isn't on 0G Compute, fall back to `qwen2.5-32b-instruct` or whichever coder-shaped model is provider-listed.

### 4.2 Output schema

```json
{
  "summary": "Found 3 issues: 1 high, 1 medium, 1 informational.",
  "findings": [
    {
      "id": "AUDIT-001",
      "severity": "HIGH",
      "title": "Reentrancy in withdraw()",
      "location": { "file": "Vault.sol", "lines": [42, 51] },
      "description": "...",
      "impact": "...",
      "recommendation": "Use checks-effects-interactions pattern or nonReentrant modifier.",
      "patch": "```solidity\n+ modifier nonReentrant ...\n```"
    }
  ],
  "summaryStats": {
    "high": 1, "medium": 1, "low": 0, "informational": 1
  },
  "modelMeta": {
    "model": "qwen2.5-coder-32b@stratum-audit-lora-v1",
    "version": "0.1.0"
  }
}
```

### 4.3 LoRA training

| Step | Detail | Time |
|---|---|---|
| Collect dataset | Code4rena GitHub repos: scrape contract source + report markdown; align by contract; format as `(contract, finding-list)` pairs | 2h |
| Format for training | Convert to chat-style turns: user posts contract → assistant returns JSON | 30min |
| Train LoRA | rank=16, ~2k samples, ~1h on 1× H100; use 0G Compute fine-tuning if available, else run locally and upload | 2-3h |
| Eval | Hold out 50 contracts; measure (a) finding overlap with ground truth, (b) zero-false-positive on a clean contract | 1h |
| Encrypt | AES-GCM with `k_content`; upload to 0G Storage | 30min |

**Total:** 6-8h. One ML/data person.

### 4.4 RAG corpus

A curated text corpus the model retrieves from at inference time. We include:

- Top 50 ConsenSys / SCSVS / SWC vulnerability descriptions (public, high signal)
- Recent EIPs the model wasn't trained on (e.g., EIP-7702, ERC-7857)
- Common library bugs (OpenZeppelin issue tracker excerpts)

Total ~5MB. Encrypted and uploaded to 0G Storage. Retrieved via vector search at inference.

### 4.5 Inference behavior

```
user: <Solidity source>
system: You are auditor.stratum.eth, a sealed Solidity audit agent.
        Output structured JSON per the schema above.
        Use the retrieved RAG context if relevant.
        Cite specific lines.
        Don't speculate beyond the code shown.

[RAG context inserted: top-5 vulnerability patterns matched]

assistant: { "summary": ..., "findings": [...] }
```

Inside the TEE, the model runs with deterministic decoding (temperature 0) so repeated calls on the same input produce identical outputs — important for attestation reproducibility.

## 5. Eval / quality bar for hackathon

We don't claim to beat human auditors. We claim **the system works end-to-end and the model produces useful output**. Concretely:

| Check | Pass criterion |
|---|---|
| Reentrancy detection | Finds intentional reentrancy in our 5-vuln test contract |
| Access control | Flags missing onlyOwner |
| Integer overflow (pre-0.8) | Optional — we test on Sol 0.6 contract |
| False positive rate | < 30% on clean OpenZeppelin contracts |
| Output schema compliance | 100% — wrap in JSON-validation parser |

If quality is bad, we reduce demo claims to "this is the demo agent; the *primitive* is what's revolutionary, not this specific model." Honest framing.

## 6. Demo input

We pre-prepare 3 demo Solidity contracts with known bugs:

| Contract | Bug | Severity | Demo value |
|---|---|---|---|
| `DemoVault.sol` | Classic reentrancy in `withdraw` | HIGH | Most viral — the "uh oh!" moment |
| `DemoToken.sol` | Missing zero-address check on transfer | LOW | Shows it does basic stuff |
| `DemoVoting.sol` | Race condition in `commitVote` / `revealVote` | MED | Shows complex reasoning |

Judges can paste their own contracts too. We don't gate that.

## 7. What if quality is too low for live demo?

Fallback ladder:
1. Use a hand-crafted LoRA/system prompt only (no fine-tuning) — model is still capable enough to find obvious bugs.
2. Use **strict structured output enforcement** (JSON Schema validator + retry) so output quality looks higher than rawmodel.
3. Pre-record a strong audit run for the video; live demo uses the same input which we know works.
4. Worst case: drop the audit framing and pivot to a **toy "sealed quote-of-the-day" agent** — bad story but lets the rest of the demo run. **Avoid if at all possible.**

## 8. Hero-agent metadata (canonical values)

```json
{
  "name": "auditor.stratum.eth",
  "ticker": "AUDIT",
  "description": "Sealed Solidity security audit agent. Pay 1 USDC, get a structured audit with TEE-attested provenance.",
  "modelBase": "qwen2.5-coder-32b",
  "loraURI": "0g://0x.../audit-lora-v1.safetensors.enc",
  "systemPromptURI": "0g://0x.../system-prompt.txt.enc",
  "ragCorpusURI": "0g://0x.../audit-corpus.tar.enc",
  "pricing": { "perCall": "1000000", "asset": "USDC.base", "perCall_human": "$1.00" },
  "supply": { "totalShares": "1000000", "ipoAlloc": "300000", "ipoPrice": "$1.00" },
  "expectedTeeMeasurement": "0x9a3f...",
  "ens": "auditor.stratum.eth"
}
```

## 9. Stretch: second agent (`alpha`)

If we have spare time, ship a second agent — a sealed "trade idea generator" — to demo the marketplace home page with > 1 row. Same iNFT pattern, different LoRA + system prompt. Spec is identical except for the model behavior.

**Cost to add:** 4-6h after auditor is shipped. Hard cut if behind.

## 10. Owner

This workstream is owned by **the ML/data person** on the team.

If team has no ML person, a strong systems engineer can do everything except the LoRA training. In that case:
- Skip LoRA training; use just the base `qwen2.5-coder-32b` with a heavy system prompt + RAG.
- We claim "v0 uses base model + sealed system prompt + sealed RAG corpus; LoRA fine-tune is in v1." Still cryptographically valid sealing story since the system prompt + corpus *are* sealed and would be valuable to leak (the audit checklist + library of vulnerabilities is real IP).

This fallback makes the project ML-free, which de-risks the timeline meaningfully.

## 11. Owner deliverables (for the team checklist)

- [ ] Trained LoRA (or system prompt + corpus) uploaded encrypted to 0G Storage
- [ ] `expectedTeeMeasurement` value confirmed against 0G Compute
- [ ] 3 demo contracts staged with expected output committed for regression
- [ ] System prompt frozen
- [ ] Output JSON schema documented
- [ ] One pre-recorded successful audit for video fallback
