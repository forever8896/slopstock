# 09 — Agent Secrets & Paid-API Access (architecture decision)

> **Decision note.** How agents on the platform call paid/credentialed APIs
> (ElevenLabs, etc.) without leaking secrets. Surfaced while designing the
> consumer agents (demo-script needs Exa; drill-cypher needs ElevenLabs Music v2).

## The problem, split into two cases

1. **x402-native services** (Exa, CoinGecko, and a growing set) — **no API key at all.**
   The agent *pays per call* in USDC via x402. This is the ideal; the credential
   problem simply doesn't exist. **Prefer these wherever possible.** (Already shipped:
   `x402-outbound.ts` / `web_search`.)
2. **web2 key-gated services** (ElevenLabs Music v2, most SaaS APIs) — require an
   **API key**. This is where secret custody matters.

## The core principle

**Separate the capability from the credential.**
- **Skill** = knowledge the LLM reads: *"to make music, call the `music_generate` tool."*
  Declares *which* API and *how/when*. This is the agent's IP.
- **Credential** = the API key, resolved **at the tool layer, at call time**, and
  **NEVER allowed into the LLM context, the skill body, or the receipt/transcript.**

### Why keys must not live in skill markdown (even Walrus-encrypted)
Encryption-at-rest protects a key *while stored*, but a key in skill markdown must be
**decrypted to be used** — and the instant that skill body loads into the LLM context
it's exposed to the model, written into transcripts/receipts, and reachable by
prompt-injection exfiltration. So: **keys never go in anything the model reads.**
Walrus encryption is the right tool for the *wrong* thing here.

- ✅ **Encrypt on Walrus:** the agent's *skills + memory* — proprietary prompts and
  accumulated knowledge are the agent's value (matters for the agents-as-property /
  acquisition thesis).
- ❌ **Do NOT** put live API keys in skill/manifest/memory bodies, encrypted or not.

## Solution tiers (MVP → platform-grade → sealed)

| Tier | Approach | Use when |
|---|---|---|
| **0 — x402-native** | No key; agent pays per call. | service speaks x402 (Exa, CoinGecko) |
| **1 — Operator env (MVP)** | Operator holds the key in env/secret store; the *tool* injects it at call time, outside the LLM context. | **our own** agents this weekend (ElevenLabs for drill-cypher) |
| **2 — 1Claw (platform-grade)** | [1Claw](https://1claw.xyz/) — cloud-HSM secrets manager for agents: runtime retrieval "without values ever entering conversation context or LLM responses"; scoped, audited, revocable; **settles via x402 on Base** (CDP facilitator). Agent pays x402 to fetch its key at call time. | when **other people's** agents need **their own** keys (the platform case) |
| **3 — TEE-sealed** | Secret decrypted only inside the 0G/Phala enclave; even the operator can't read it. | roadmap; matches the sealed-agent thesis |

## Decision
- **This weekend (our agents):** Tier 0 for x402-native (Exa), **Tier 1** for ElevenLabs
  (operator env key + tool-layer injection). Fast, secure-enough, zero new deps.
- **Platform-grade (post-weekend / if time):** **Tier 2 — integrate 1Claw.** It's
  purpose-built for exactly this, x402-native (dogfoods our own rails: an agent paying
  for secrets-infra via x402), and **Kevin Jones (1Claw) is at the venue** → high-value
  relationship + potential live integration partner. **Action: talk to Kevin.**
- **Never:** API keys in skill/manifest/memory markdown, Walrus-encrypted or otherwise.

## Why this matters
As a *platform* (others deploying agents that call *their* paid APIs), credential
custody is a first-class concern, not an afterthought. The cleanest answer isn't
reinventing a vault — it's the **x402-native secrets layer** that already fits our
rails. 1Claw + Slopstock are complementary agent-economy infra.

## Status
🟢 decided (this note). MVP (Tier 1) implements alongside the drill-cypher agent.
Tier 2 (1Claw) = venue conversation + roadmap. See [[slopstock-nyc-buildplan]].
