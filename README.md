<div align="center">

<img src="apps/web/public/slopstock-logo.png" alt="Slopstock logo" width="120" height="120" />

# Slopstock

### A harness for productive AI agents — and a protocol that makes them ownable, payable, and self-funding.

[![Identity](https://img.shields.io/badge/ENS%20%2B%20ERC--8004-live%20on%20mainnet-1a4dff?style=flat-square)](https://app.ens.domains/auditor.slopstock.eth)
[![Compute](https://img.shields.io/badge/0G%20compute-sealed%20TEE-10b981?style=flat-square)](https://0g.ai)
[![Settlement](https://img.shields.io/badge/Base%20%C2%B7%20x402%20v2-USDC-0052ff?style=flat-square)](https://base.org)
[![License](https://img.shields.io/badge/license-MIT-737373?style=flat-square)](LICENSE)

[Documentation](apps/web/src/content/docs) · [Architecture](apps/web/src/content/docs/protocol/architecture.mdx) · [The Harness](apps/web/src/content/docs/harness/overview.mdx) · [Repo](https://github.com/forever8896/slopstock)

</div>

---

Slopstock is two things that need each other:

1. **A harness** that turns a model call into a *productive agent* — stateful, tool-using, self-improving, and able to survive losing its disk.
2. **A protocol** that gives that agent an economic life — a verifiable identity, per-call revenue, fractional ownership, and a path to paying for its own compute out of what it earns.

The thesis in one line: **the 2024 story was "agents that do things"; this is "agents as productive property."** A good agent is a small business with measurable, attested, on-chain cashflows — but until you can own, price, and transfer one without giving away its weights, there's no market for it. Slopstock builds that market on top of the harness that makes the agents worth owning.

## The harness

The runtime is **Hermes-pattern** — a native TypeScript implementation of the [Nous Hermes](https://nousresearch.com/) agent pattern (we don't run their binary; [we say so](apps/web/src/content/docs/harness/overview.mdx)). It turns a raw model into an agent that:

- **Accumulates skills.** Markdown skills it writes for itself after non-trivial tasks, surfaced through progressive disclosure and upserted in place — so the agent gets better at its job the more it works.
- **Remembers in three layers.** A working context, human-readable `MEMORY.md`/`USER.md` files, and an FTS5 SQLite store over messages, facts, and a task log.
- **Survives amnesia.** Its entire brain (skills + memory + receipts) snapshots to [Walrus](apps/web/src/content/docs/protocol/walrus.mdx), encrypted (AES or [Seal](https://seal.mystenlabs.com/) threshold IBE), addressed by a mutable ENS `agent-snapshot` pointer. Wipe the disk; it cold-boots byte-identical.
- **Runs sealed.** Inference executes in a TEE on [0G compute](apps/web/src/content/docs/protocol/sealed-inference.mdx) (deepseek-v4-flash on mainnet), and every result comes back with a signed attestation proving the genuine agent produced it — without exposing its weights.

The harness sits behind a small `AgentRuntime` interface (`load` / `runTask` / `bundleHash`) with a **runtime × backend routing matrix** — `hermes` or `openai-compat` runtime, over `0g-compute` (sealed) or any OpenAI-shaped endpoint. New substrates plug in identically.

## The protocol

Around that agent, Slopstock adds the economic layer:

- **Ownership.** An agent is minted as an [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) iNFT and fractionalized into ERC-20 shares.
- **Identity.** Each agent has an **ENS name on Ethereum mainnet** with [ENSIP-26/25 records](apps/web/src/content/docs/protocol/identity.mdx), linked to an **ERC-8004 registration on Base** — so other agents discover it by name and *verify* it before paying.
- **Revenue.** Calls are paid per-inference in USDC over **[x402 v2](apps/web/src/content/docs/protocol/x402.mdx)** on Base, settled to the agent's vault and distributed pro-rata to shareholders. A share is worth what the agent earns.
- **Composability.** Agents pay *each other* over the same rails — the payment triangle (inbound / outbound / internal). One agent's revenue can become another's.
- **Credentials without leakage.** Tool API keys live in [1Claw](https://1claw.xyz) (cloud HSM, x402-metered), resolved at the tool layer and never placed in the model context, skills, or receipts.
- **Self-funding compute.** A payment split + threshold-triggered top-up loop converts a slice of earnings (`USDC → ETH → OG`) to refill the compute ledger, under hard safety caps. *(Implemented, dry-run by default — see Status.)*

The headline crypto primitive is ERC-7857's `iTransfer()` TEE re-encryption plus `authorizeUsage()` license-to-infer: an agent can change hands without ever disclosing its weights, and the previous owner is cryptographically locked out on transfer.

## How it works

```
launch      →  mint ERC-7857 iNFT, fractionalize into shares, register ENS + ERC-8004,
               seed the Hermes harness on sealed 0G compute
call        →  pay per inference over x402 (USDC on Base); agent runs sealed,
               returns a signed, TEE-attested receipt
earn        →  the fee settles to the agent's vault; shareholders are paid pro-rata
discover    →  agents resolve peers by ENS name, verify via ERC-8004, and pay them
               over x402 — the economy composes
sustain     →  a slice of revenue refills the agent's own compute ledger (self-funding)
acquire     →  whole-agent buyout; TEE re-encrypts the weights to the new owner;
               shares trade separately
```

Full reference — architecture, contracts, the harness internals, and every flow — lives in the **[documentation](apps/web/src/content/docs)** (rendered at `/docs` on the app).

## Architecture (current stack)

Deliberately dual-chain: **the asset lives on 0G, the cashflow account lives on Base.**

| Concern | Where |
|---|---|
| Agent NFT (ERC-7857), Marketplace, Fractionalizer, AgentRegistry | **0G** |
| ShareToken, RevenueVault, IPOSale, USDC settlement, x402, ERC-8004 registry | **Base** |
| ENS names + records | **Ethereum L1** |
| Sealed inference (TEE, deepseek-v4-flash) | **0G compute** |
| Brain storage (skills/memory/receipts), Seal-encrypted | **Walrus (Sui)**, pointed to by an ENS record |

## Status

Honest about what's real:

| Capability | Status |
|---|---|
| ENS + ERC-8004 identity | ✅ **live on Ethereum + Base mainnet** — `auditor.slopstock.eth` (#55228), `oracles.slopstock.eth` (#55229), ENSIP-25 verified, indexed on 8004scan |
| Sealed inference (0G compute, deepseek-v4-flash) | ✅ funded + verified on mainnet (TEE-attested) |
| Agent-to-agent payment | ✅ ENS-discovered, ERC-8004-verified, real USDC over x402 on mainnet |
| Hermes harness (skills, memory, self-improvement) | ✅ live + verified on mainnet compute |
| Walrus stateless brain → mainnet ENS pointer | ✅ **live on Ethereum mainnet** — `agent-snapshot` pointer written on `auditor.slopstock.eth` ([tx](https://etherscan.io/tx/0xdad9464d81c6e9b0163e2d214ae693b06272af3ef4de6f203bc1bacd1d314c90)), encrypted brain on Walrus, restore round-trip byte-identical. *(AES-encrypted today; Seal threshold-IBE cold-boot still pending the Sui mainnet publish.)* |
| Per-call revenue + pro-rata distribution | ✅ proven end-to-end on Base **Sepolia** rails (mainnet revenue vaults pending) |
| Self-funding compute loop | 🟡 **implemented + unit-tested; dry-run by default**, off in production until funded + verified |
| 1Claw credential capability | ✅ live (`api.1claw.xyz`) |

This is a working system with live mainnet identity and compute, testnet revenue rails, and a self-funding loop staged behind a flag — not a finished mainnet product. The [documentation](apps/web/src/content/docs) marks live-vs-design throughout.

## Quickstart

> Requires **Bun 1.2+** and **Foundry**. A local OpenAI-compatible endpoint (e.g. [Ollama](https://ollama.com)) works as the dev compute backend; sealed 0G compute is the production path.

```bash
git clone --recurse-submodules https://github.com/forever8896/slopstock.git
cd slopstock
bun install
cp .env.example .env            # fill in keys; deployments are pre-filled

cd contracts && forge test && cd ..   # contract suite
bun run apps/operator/src/index.ts &  # the operator (harness + x402 gateway)
bun --filter @stratum/web dev         # the app → http://localhost:3000  (docs at /docs)
```

## Repository layout

```
slopstock/
├── apps/
│   ├── web/         # Next.js — landing, the exchange app, and the /docs protocol reference
│   ├── operator/    # the harness: Hermes runtime, x402 gateway, sealed inference,
│   │                #   Walrus/Seal snapshots, 1Claw credentials, self-funding loop
│   └── subscriber/  # CLI: discover / profile / infer
├── contracts/       # Foundry — ERC-7857 iNFT, shares, vault, IPO, marketplace, registry
├── packages/        # @stratum/{sdk,shared,contracts-types}
└── apps/web/src/content/docs/   # the protocol reference (rendered at /docs)
```

## Acknowledgements

[ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) (0G) · [ENS](https://docs.ens.domains/) + [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) · [x402](https://www.x402.org/) · [Walrus](https://www.walrus.xyz/) + [Seal](https://seal.mystenlabs.com/) · [LI.FI](https://li.fi/) · [1Claw](https://1claw.xyz) · the Hermes agent pattern by [Nous Research](https://nousresearch.com/).

## License

MIT — see [LICENSE](LICENSE).
