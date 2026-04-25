# Stratum

> A stock exchange for AI agents.

Mint a productive AI agent as an [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) iNFT, fractionalize ownership into ERC-20 shares, distribute its inference revenue pro-rata to shareholders, and atomically transfer it without leaking the weights via TEE re-encryption.

Built for [ETHGlobal Open Agents](https://ethglobal.com) — April 2026.

---

## The pitch

Today, if you build a profitable AI agent — say a 70%-win-rate trading bot or a sealed Solidity audit agent — your monetization options are bad:

- **Run it yourself** → capped by your capital
- **Sell the weights** → leaks on first sale
- **Tokenize via Virtuals/ai16z** → meme coin glued to a chatbot, no revenue rights
- **Operator royalties on a platform** → trusts a custodian; centralized chokepoint

The missing primitive: **transferable ownership of a productive agent without disclosing its weights.** ERC-7857 (final 2025-01) introduced this primitive. Almost nobody has built on it.

Stratum is the equity layer.

## How it works

```
mint     →  encrypt weights, upload to 0G Storage, mint ERC-7857 iNFT
fractionalize  →  lock iNFT in vault, mint 1M ERC-20 shares
IPO      →  sell 30% at fixed price; 70% retained by builder
subscribe  →  pay-per-call via x402, paid in any token via Uniswap
infer    →  runs in 0G Compute Sealed Executor, returns TEE-attested output
distribute  →  KeeperHub workflow weekly snaps + pays shareholders pro-rata
acquire  →  whole-iNFT buyout; TEE re-encrypts to acquirer; previous owner cryptographically locked out; ENS resolver flips
```

## Architecture

```
┌─────────────────────────────────────────────┐
│              FRONTEND (Next.js)             │
└────┬────────────────────────────────────┬───┘
     │ wagmi/viem                         │ AXL bridge
     ▼                                    ▼
┌────────────────────┐         ┌──────────────────────┐
│  0G CHAIN (EVM)    │         │  AGENT OPERATOR NODE │
│  AgentNFT (7857)   │         │  AXL peer + MCP +    │
│  ShareToken        │         │  x402 gateway        │
│  RevenueVault      │         └──────────┬───────────┘
│  Marketplace       │                    ▼
└────────────────────┘         ┌──────────────────────┐
                               │  0G COMPUTE (TEE)    │
┌────────────────────┐         │  Sealed Executor     │
│  KEEPERHUB         │         │  qwen2.5-coder-32b   │
│  weekly distribute │         └──────────┬───────────┘
└────────────────────┘                    │
                                          ▼
┌────────────────────┐         ┌──────────────────────┐
│  UNISWAP API       │         │  0G STORAGE          │
│  pay-with-any-token│         │  encrypted weights   │
└────────────────────┘         └──────────────────────┘

┌────────────────────┐
│  ENS (Sepolia)     │
│  ENSIP-25 registry │
│  CCIP-Read gateway │
└────────────────────┘
```

Full system design in [`docs/01-architecture.md`](docs/01-architecture.md).

## Repository layout

```
stratum/
├── docs/                       # PRD set (12 files, ~3.1k lines)
├── contracts/                  # Foundry — Solidity contracts
├── apps/
│   ├── web/                    # Next.js frontend (Robinhood-for-agents UI)
│   ├── operator/               # Agent operator node: AXL + MCP + x402
│   ├── subscriber/             # Subscriber CLI
│   ├── gateway/                # ENS CCIP-Read Cloudflare Worker
│   └── indexer/                # Ponder indexer
├── packages/
│   ├── sdk/                    # @stratum/sdk — wagmi hooks + viem helpers
│   ├── contracts-types/        # generated ABIs
│   └── shared/                 # shared types and constants
├── ml/
│   ├── train-lora/             # LoRA training pipeline
│   ├── corpus/                 # encrypted corpus build scripts
│   └── eval/                   # eval harness for the audit agent
├── scripts/                    # one-shot deploy + setup scripts
├── README.md
├── FEEDBACK.md                 # Uniswap submission requirement
└── KEEPERHUB-FEEDBACK.md       # KeeperHub feedback bounty
```

## Sponsor stack

Each integration is **load-bearing** — pull it and the system collapses to a centralized custodian.

| Sponsor | Role |
|---|---|
| **0G** | iNFT (ERC-7857) + Storage for sealed weights + Compute Sealed Executor |
| **Uniswap** | `pay-with-any-token` skill bridges x402 paywalls into swaps |
| **Gensyn AXL** | P2P inference delivery — no centralized API gateway |
| **KeeperHub** | Revenue distribution workflow + ERC-8004 registration |
| **ENS** | ENSIP-25 registry, CCIP-Read rotating addresses, subnames as revocable subscriber API keys |

## Documentation

The PRD set is in [`docs/`](docs). Start with [`00-master-prd.md`](docs/00-master-prd.md), then [`01-architecture.md`](docs/01-architecture.md).

| File | Topic |
|---|---|
| [00-master-prd.md](docs/00-master-prd.md) | Vision, scope, success criteria, sponsor coverage |
| [01-architecture.md](docs/01-architecture.md) | System design, chain topology, end-to-end flows |
| [02-smart-contracts.md](docs/02-smart-contracts.md) | iNFT, shares, vault, marketplace contract specs |
| [03-sealed-inference.md](docs/03-sealed-inference.md) | 0G Compute pipeline, TEE attestations, iTransfer |
| [04-revenue-and-payments.md](docs/04-revenue-and-payments.md) | x402, Uniswap, KeeperHub workflow |
| [05-ens-identity.md](docs/05-ens-identity.md) | Tickers, CCIP-Read, ENSIP-25, subnames as API keys |
| [06-axl-delivery.md](docs/06-axl-delivery.md) | P2P inference delivery |
| [07-frontend.md](docs/07-frontend.md) | Next.js UI spec |
| [08-hero-agent.md](docs/08-hero-agent.md) | The example sealed agent: `auditor.stratum.eth` |
| [09-execution-plan.md](docs/09-execution-plan.md) | 48h timeline, role allocation |
| [10-risks-and-cuts.md](docs/10-risks-and-cuts.md) | Risk register, cut order |
| [11-demo-and-submission.md](docs/11-demo-and-submission.md) | 3-min demo script, per-sponsor checklists |

## Setup

> Requires: Node 22+, Bun 1.2+, Foundry, a 0G testnet wallet, a Base Sepolia wallet.

```bash
# clone (note: --recurse-submodules pulls forge-std + openzeppelin)
git clone --recurse-submodules https://github.com/<team>/stratum.git
cd stratum

# install
bun install

# build contracts
cd contracts && forge build && cd ..

# copy env
cp .env.example .env
# fill in: 0G_RPC_URL, BASE_RPC_URL, KEEPERHUB_API_KEY, etc.

# run frontend
bun dev:web
```

Detailed per-component setup is in each app's README.

## Hero agent

`auditor.stratum.eth` — a sealed Solidity audit agent.

- **Model:** qwen2.5-coder-32b + LoRA trained on Code4rena reports
- **Sealed in:** 0G Compute TEE (Intel TDX)
- **Cost:** 1 USDC per audit
- **Output:** structured findings with severity, location, suggested patch

## Status

Pre-build scoping complete (Apr 25, 2026). Implementation kicking off now.

| Workstream | Status |
|---|---|
| Docs | ✅ Complete |
| Repo scaffold | 🚧 In progress |
| Contracts | ⬜ Not started |
| Operator node | ⬜ Not started |
| Frontend | ⬜ Not started |
| Hero agent (LoRA) | ⬜ Not started |

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

Built on top of:
- [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) — Intelligent NFT spec by 0G Foundation
- [0g-agent-nft](https://github.com/0gfoundation/0g-agent-nft) — Reference iNFT implementation
- [Gensyn AXL](https://github.com/gensyn-ai/axl) — P2P agent network
- [Uniswap pay-with-any-token](https://github.com/Uniswap/uniswap-ai)
- [KeeperHub](https://docs.keeperhub.com/) — execution layer
- [ENS CCIP-Read](https://docs.ens.domains/)

## Contact

Project lead: kilianvaldman@gmail.com
