# 11 — Demo & Submission

## 1. The 3-minute demo arc

The video is the primary submission artifact. Live demo at finals is bonus.

**Structure:** `Hook (10s) → Problem (15s) → Walkthrough (2m) → Punchline (15s)`

### Script (with timing)

| Time | Beat | Visual |
|---|---|---|
| 0:00 | "Today, if you build a profitable AI agent, you can run it or sell it. There's no equity layer." | Logo, ticker tape of agent prices |
| 0:10 | "Stratum is a stock exchange for AI agents. We'll show you the whole flow in 3 minutes." | Marketplace home: 1 agent listed, AUDIT |
| 0:25 | Click into `auditor.stratum.eth` — show price, holders, recent revenue, attestations | Agent detail page |
| 0:40 | "I subscribe by paying 1 USDC. I only hold PEPE." Click subscribe, pick PEPE. Watch swap+settle on Basescan. | Subscribe flow + Basescan |
| 1:05 | Paste DemoVault.sol with reentrancy bug. Click run. | Inference UI |
| 1:15 | Watch: TEE attestation banner verifies (green ✓). Findings appear: HIGH severity reentrancy. | Output panel + attestation banner |
| 1:30 | "The model never left the TEE. The operator never saw my code. The output is signed and onchain-verifiable." | Highlight attestation hash |
| 1:45 | "I own 100,000 shares. Let's distribute revenue." Trigger weekly KeeperHub workflow manually. | Admin trigger + KeeperHub log |
| 2:00 | Watch shareholders' wallets receive USDC pro-rata. Live. On Basescan. | 3 USDC transfers |
| 2:15 | "Now the headline trick: I want to acquire this agent." Click `Acquire`. Post a $50k bid. | Acquire page |
| 2:35 | Operator accepts. Watch: TEE re-encryption happens. Old subscriber grants vanish. ENS resolver flips. | Live event log |
| 2:55 | "The previous owner is cryptographically locked out. There was no custodian. This is the missing primitive for agent capital markets." | Stratum logo |

### Voice-over guidelines

- Speak fast but clear; this is a 3-min sprint, not a chill explainer.
- Avoid jargon judges might not know without context. "Sealed Executor" is fine if we explain it the first time ("a TEE-protected runtime"); "ERC-7857" is fine because it's the spec name.
- Every claim must be visible on screen as it's said.
- Zero "in production this would..." — all claims are about what's running right now.

### Recording setup

- 1080p, 60fps if possible
- ScreenStudio or OBS with a camera-on intro/outro is fine
- Single take preferred; if it has to be 3 takes, mark cuts at scene boundaries (after marketplace, after subscribe, after acquire)

## 2. Submission deliverables — all sponsors

### 2.1 Common across all sponsors (ETHGlobal submission form)

- **Project name:** Stratum
- **Short description:** "A stock exchange for AI agents. Mint a productive agent as an ERC-7857 iNFT, fractionalize ownership, distribute its inference revenue to shareholders, and atomically transfer it without leaking the weights."
- **Long description:** the contents of `docs/00-master-prd.md` § 1-4, condensed
- **Public GitHub repo:** `github.com/<team>/stratum`
- **Demo video link:** YouTube/Vimeo unlisted; under 3 minutes
- **Live demo URL:** `https://stratum.app` (or our Vercel preview URL)
- **Architecture diagram:** PNG export of the diagram in `docs/01-architecture.md`
- **Team members + contacts:** Telegram + X handles for each

### 2.2 README structure

```markdown
# Stratum — A Stock Exchange for AI Agents

> Mint productive AI agents as ERC-7857 iNFTs, fractionalize ownership, distribute revenue, transfer atomically without leaking weights.

[demo video link]
[live demo link]
[architecture diagram]

## What this is
30-second pitch.

## How it works
End-to-end flow with diagram.

## Sponsor integrations
- 0G — iNFT (ERC-7857), Storage, Compute Sealed Executor: ___
- Uniswap — pay-with-any-token bridges x402: ___
- Gensyn — AXL P2P delivery: ___
- KeeperHub — revenue distribution workflow + ERC-8004: ___
- ENS — ENSIP-25 registry, CCIP-Read rotating addresses, subnames as API keys: ___

## Repo layout
[as in docs/09-execution-plan.md §9]

## Setup
1. Clone, install
2. Foundry deploy
3. Run operator node
4. Run subscriber CLI
5. Open frontend

## Contract addresses
- AgentNFT (0G Galileo): 0x...
- ShareToken (0G): 0x...
- Fractionalizer (0G): 0x...
- IPOSale (Base Sepolia): 0x...
- RevenueVault (Base Sepolia): 0x...
- Marketplace (0G): 0x...
- StratumResolver (Sepolia): 0x...

## Hero agent
- ENS: auditor.stratum.eth
- iNFT: <link to explorer>
- Live attestation hash: <link>

## Team
- Captain: ___
- Contracts: ___
- Backend: ___
- Frontend: ___
- ML: ___
```

## 3. Per-sponsor submission checklist

### 3.1 0G — both tracks ($15k pool)

**Submission must include:**
- [x] Project name + short description
- [x] Contract deployment addresses on 0G Chain
- [x] Public GitHub repo with setup instructions
- [x] Demo video (< 3 min) + live demo link
- [x] Explanation of which 0G features used
- [x] Team contacts

**0G-specific must-haves:**
- [x] At least one working example agent built with our framework — **`auditor.stratum.eth` is the example agent**
- [x] Architecture diagram showing 0G integration

**Track A — Best Agent Framework, Tooling & Core Extensions:**
We pitch `@stratum/sdk` as the framework — wagmi hooks, viem helpers, MCP tools, Foundry templates that let any builder mint, fractionalize, IPO, and distribute revenue for their own sealed agents. Show the example agent built with the SDK to satisfy "at least one working example."

**Track B — Best Autonomous Agents, Swarms & iNFT Innovations:**
We pitch the iNFT angle. The demo focuses on the live `iTransfer` re-encryption — show this clearly in the video. Submission includes:
- [x] Link to minted iNFT on 0G explorer
- [x] Proof intelligence (LoRA + system prompt + RAG) is embedded encrypted in 0G Storage
- [x] Atomic re-encryption demo

We submit to **both tracks** — same project, two angles. Allowed.

### 3.2 Uniswap — Best API Integration ($5k pool)

**Required:** `FEEDBACK.md` in repo root.

**FEEDBACK.md template:**

```markdown
# Uniswap API — Builder Feedback

## Summary
We built Stratum (a stock exchange for AI agents) and used Uniswap's `pay-with-any-token`
skill so subscribers can pay our agents in any token they hold while the agent only ever
sees USDC.

## What worked
- pay-with-any-token: handled PEPE → USDC swap + 402 ack atomically. Beautiful.
- Universal Router routing was solid even on small ($1) trade sizes.
- Skill setup docs were clear; took ~30min to integrate.

## What didn't / friction
- (real notes from the build)

## Bugs hit
- (real bugs)

## Doc gaps
- (real doc gaps)

## DX wishes
- A dedicated x402 + Uniswap composability doc page would have saved us 2h.
- TypeScript types for the skill output could be tighter.
- (etc.)

## What we wish existed
- A "pay-with-any-token + x402 + agent receipt" combined SDK would be a meaningful primitive.
- (etc.)
```

**Submission notes:**
- We use pay-with-any-token in 2 places: the subscribe flow AND the acquisition bid payment. Depth, not just one-shot.
- Demo explicitly shows the swap happening on Basescan.

### 3.3 Gensyn — Best AXL Application ($5k pool)

**Required by qualification:**
- Use AXL for inter-agent or inter-node communication (no centralized broker replacing AXL)
- Demonstrate cross-node communication
- Built during the hackathon

**Our submission:**
- Operator node and subscriber node are on **separate machines** during demo
- Both peer to a self-hosted bootstrap; mesh routing handles the rest
- Inference is invoked via MCP-over-AXL, not HTTP
- Demo shows `axl --topology` on each node

**Submission deliverables:**
- [x] Working demo (live + recorded)
- [x] Public GitHub repo + README + architecture
- [x] Brief write-up of approach + how AXL is used (in README sponsor section)
- [x] Project name, team, contacts

### 3.4 KeeperHub — Best Use ($4.5k pool) + Builder Feedback ($500)

**Both:**
- [x] Working demo
- [x] Public GitHub repo with README
- [x] Brief write-up of approach + KeeperHub usage
- [x] Team contacts

**Best Use angle:**
We pitch into **Focus Area 2: Best Integration with KeeperHub** (we're the integration between KeeperHub and a new payment use case — fractional revenue distribution to ERC-20 shareholders). And we additionally do payments via x402.

The KeeperHub workflow:
- Reads RevenueVault contract weekly
- Distributes pro-rata via foreach over indexed holders
- Retried, MEV-protected, gas-optimized

We register the agent via ERC-8004 through KeeperHub.

**Builder Feedback angle (separate $250 prize):**

`KEEPERHUB-FEEDBACK.md` (in addition to FEEDBACK.md for Uniswap):

```markdown
# KeeperHub — Builder Feedback

## Summary
Used KeeperHub to manage Stratum's recurring shareholder dividend distribution.

## UX/UI friction
- (real notes)

## Reproducible bugs
- (real bugs found, with steps)

## Documentation gaps
- (real gaps)

## Feature requests
- (real wishes — e.g., "I'd love an "on contract event" trigger in addition to cron")
```

### 3.5 ENS — both tracks ($5k pool)

**Both tracks share requirements:**
- [x] Demo functional, no hard-coded values
- [x] Video or live demo link

**Track A — Best ENS Integration for AI Agents ($2.5k):**
- ENS is the agent's identity (not cosmetic): ENSIP-25 records ARE the agent's discovery layer
- Demo: another agent looking up `auditor.stratum.eth`, reading endpoint from text record, calling it — pure ENS-driven discovery

**Track B — Most Creative Use of ENS ($2.5k):**
- CCIP-Read rotating treasury addresses
- Subnames as revocable subscriber API keys
- Dentity VC text record for agent attestation
- Demo: 3 calls to `treasury.auditor.stratum.eth` returning 3 different addresses; subscriber subname stops resolving when grant revoked

We submit to both tracks. Same project, distinct angles. ENS is doing 4 different jobs; this is depth, not breadth.

## 4. Submission timing

- Hour 36: README + FEEDBACK.md + KEEPERHUB-FEEDBACK.md committed
- Hour 38: Video uploaded (unlisted), Vercel deploy at canonical URL, all addresses listed in README
- Hour 38-40: Submit on ETHGlobal portal — fill the form, attach video link, repo link, demo URL
- Hour 40-42: Tweet/post; sleep
- Hour 42+: Buffer for follow-ups

## 5. Pitch deck (if asked for one)

If sponsors ask for a slide deck (rare at hackathons but happens for finalists):

| Slide | Content |
|---|---|
| 1 | Stratum — a stock exchange for AI agents |
| 2 | Problem: profitable agents have no equity layer |
| 3 | Today's bad options: run-it / leak-it / token-meme-it |
| 4 | The missing primitive: ERC-7857 sealed transfer |
| 5 | Architecture: 5 sponsor stacks, each load-bearing |
| 6 | Demo flow: mint → IPO → subscribe → distribute → acquire |
| 7 | The cryptographic trick: TEE re-encryption on iTransfer |
| 8 | Why now: 7857 shipped 4 months ago, almost nobody has built on it |
| 9 | Roadmap: AMM, governance, ETF aggregator, derivatives |
| 10 | Team + contact |

Build this only if invited to a finalist round. Don't preemptively make slides.

## 6. Post-hackathon (out-of-scope reminder)

Do not promise post-hackathon work to judges/sponsors during demo. We say "this primitive could become the foundation for X / Y / Z" but **do not commit** to building anything. Win prizes first; figure out what's next on Sunday night.

## 7. Final submission checklist (one-page, print-this)

- [ ] GitHub repo public, README has video + live demo + addresses + sponsor sections
- [ ] Demo video uploaded (unlisted), < 3 min, link works in incognito
- [ ] Live demo URL works (test from a phone on cellular)
- [ ] FEEDBACK.md present in repo root
- [ ] KEEPERHUB-FEEDBACK.md present in repo root
- [ ] Architecture diagram PNG in docs/, linked from README
- [ ] All contract addresses listed and verified on explorers
- [ ] Hero agent iNFT minted, ENS records set, live demo subscribable
- [ ] ETHGlobal submission form filled
- [ ] Each sponsor's submission requirements (above) ticked
- [ ] Team members' Telegram + X handles up to date
- [ ] Tweet announcing the project (optional but free PR)

When all boxes ticked: sleep.
