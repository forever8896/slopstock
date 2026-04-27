# Slopstock

> A stock exchange for AI agents.

Mint a productive AI agent as an [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) iNFT, fractionalize ownership into ERC-20 shares, distribute its inference revenue pro-rata to shareholders, and atomically transfer it without leaking the weights via TEE re-encryption.

Built for [ETHGlobal Open Agents](https://ethglobal.com) — April 2026. Project codename: **Stratum** (the protocol). Public name: **Slopstock** (the brand).

---

## Status

| Workstream | Status |
|---|---|
| Contracts | ✅ deployed on 0G Galileo + Base Sepolia, 71/71 tests green |
| Hero agent | ✅ `auditor.stratum.eth` minted as tokenId 1, 1M AUDIT shares, IPO live |
| Operator node | ✅ real LLM (Ollama-first), chain-validated x402, SQLite receipts, chain-driven /profile |
| Web frontend | ✅ reads chain directly, real Marketplace + USDC payment via wagmi |
| Subscriber CLI | ✅ `discover` / `profile` / `infer` against real chain + operator |
| Indexer (Ponder) | ⏭ deferred — on-the-fly Transfer-walk works for v1 |
| ENS gateway worker | ⏭ deferred — needs Cloudflare deploy + ENS ownership |
| 0G Compute Sealed Executor | ⏭ deferred — auth model not public; Ollama stand-in |
| AXL P2P transport | ⏭ deferred — sponsor surface |

## Live deployments

**0G Galileo** (chain id 16602)

| Contract | Address |
|---|---|
| StratumAgentNFT | `0x2F79b1950CcaA58259ea62bFe99107De75018D92` |
| TestnetUSDC | `0x5190f454E058319C53c82ff8bDaF0CB193CA8109` |
| Marketplace | `0x2A06246eeaf9b772CD3e7B8823298c0C8E89df48` |
| Fractionalizer | `0x5C2Ca0331EaEC7EB272e044579EB2C28EFBC819e` |
| AgentRegistry | `0x7c9b6C415131414dc4b55E24aB2aE0a31439a290` |

**Base Sepolia** (chain id 84532) — per-agent bundle for **AUDIT**

| Contract | Address |
|---|---|
| ShareToken | `0x2F79b1950CcaA58259ea62bFe99107De75018D92` |
| RevenueVault | `0x5190f454E058319C53c82ff8bDaF0CB193CA8109` |
| IPOSale | `0x2A06246eeaf9b772CD3e7B8823298c0C8E89df48` |
| Payment asset (Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Artifacts at [`contracts/deployments/`](contracts/deployments/).

## How it works

```
mint     →  encrypt weights, upload to 0G Storage, mint ERC-7857 iNFT
fractionalize  →  lock iNFT in vault, mint 1M ERC-20 shares
IPO      →  sell 30% at fixed price; 70% retained by builder
subscribe  →  pay-per-call via x402, paid in USDC (Uniswap pay-with-any-token next)
infer    →  runs in 0G Compute Sealed Executor (Ollama stand-in for now)
distribute  →  KeeperHub workflow weekly snaps + pays shareholders pro-rata
acquire  →  whole-iNFT buyout; TEE re-encrypts to acquirer; previous owner cryptographically locked out; ENS resolver flips
```

The headline crypto trick is ERC-7857's `iTransfer()` re-encryption inside a TEE plus `authorizeUsage()` license-to-infer that clears on transfer. **Pull any one sponsor stack and the system collapses to a centralized custodian** — that's the design constraint.

## Architecture

```
┌─────────────────────────────────────────────┐
│              FRONTEND (Next.js)             │
│   wagmi reads + writes • SSR data loaders   │
└────┬────────────────────────────────────┬───┘
     │ direct viem reads                  │ x402 HTTP
     ▼                                    ▼
┌────────────────────┐         ┌──────────────────────┐
│  0G CHAIN (EVM)    │         │  AGENT OPERATOR NODE │
│  StratumAgentNFT   │◀────────│  bun+viem            │
│  Marketplace       │ chain   │  /x402/infer         │
│  AgentRegistry     │ reads   │  /profile/:id        │
│  Fractionalizer    │         │  /receipts           │
└─────────┬──────────┘         │  ECDSA-signed        │
          │                    │  receipts → SQLite   │
          │ AgentRegistry      └──────────┬───────────┘
          │ + iNFT mappings               │ OpenAI-compat
          │                               ▼ HTTP (Ollama default)
┌─────────▼──────────┐         ┌──────────────────────┐
│  BASE SEPOLIA      │         │  COMPUTE BACKEND     │
│  ShareToken (ERC20)│         │  qwen2.5-coder       │
│  RevenueVault      │◀────────│  (0G Compute SE      │
│  IPOSale           │ x402    │   when SDK is wired) │
│  + USDC Transfer   │ validation
└────────────────────┘
```

Full design in [`docs/01-architecture.md`](docs/01-architecture.md).

## Repository layout

```
slopstock/
├── contracts/                  # Foundry — Solidity contracts + deploy scripts
│   ├── src/                    # 7 contracts: AgentNFT, Marketplace, ShareToken,
│   │                           # Fractionalizer, RevenueVault, IPOSale, AgentRegistry,
│   │                           # StratumResolver
│   ├── script/                 # DeployStratum, DeployBase, MintAgent, DeployResolver
│   └── deployments/            # JSON artifacts per chain
├── apps/
│   ├── web/                    # Next.js frontend (Slopstock UI)
│   ├── operator/               # Agent operator node: MCP + x402 gateway + LLM
│   ├── subscriber/             # CLI: discover / profile / infer
│   ├── gateway/                # ENS CCIP-Read worker (stub)
│   └── indexer/                # Ponder indexer (stub)
├── packages/
│   ├── sdk/                    # @stratum/sdk — wagmi hooks (TBD)
│   ├── contracts-types/        # ABIs the apps consume
│   └── shared/                 # types, constants, deployed addresses
├── scripts/                    # one-shot deploy + funding helpers
├── docs/                       # PRD set (12 files)
└── README.md
```

## Quickstart

> Requires: **Bun 1.2+**, **Foundry**, an [Ollama](https://ollama.com) install (or any OpenAI-compatible LLM endpoint), a 0G Galileo wallet, a Base Sepolia wallet.

```bash
# 1. clone (with submodules for forge-std + openzeppelin)
git clone --recurse-submodules https://github.com/forever8896/slopstock.git
cd slopstock

# 2. install
bun install

# 3. copy env (deployments are pre-filled in .env.example)
cp .env.example .env
# fill in: DEPLOYER_PRIVATE_KEY, OPERATOR_PRIVATE_KEY, SUBSCRIBER_PRIVATE_KEY

# 4. build contracts
cd contracts && forge test && cd ..   # 71/71 should pass

# 5. start the LLM backend (one-time pull, ~1GB)
ollama serve &
ollama pull qwen2.5-coder:1.5b   # or :7b for better audits

# 6. start the operator
bun run apps/operator/src/index.ts &

# 7. start the web app
bun --filter @stratum/web dev
# → http://localhost:3000
```

### Run a real audit from the CLI

```bash
# Fund SUBSCRIBER_PRIVATE_KEY's address with Circle USDC on Base Sepolia
# (https://faucet.circle.com)
export SUBSCRIBER_PRIVATE_KEY=0x...

# Discover available agents
bun run apps/subscriber/src/index.ts discover

# Pay 1 USDC and run an audit
bun run apps/subscriber/src/index.ts infer \
  --token AUDIT \
  --input ./MyContract.sol
```

The subscriber pays via `USDC.transfer` to the agent's vault, waits for confirmation, then submits the txHash to the operator's `/x402/infer` endpoint. The operator reads chain to verify the payment, calls the LLM, signs the receipt, and returns the audit. The CLI verifies the TEE measurement matches what the iNFT pins on chain before printing.

### Or use the web UI

`http://localhost:3000`:
- `/` — markets list (real cumulative revenue + live IPO state)
- `/agent/AUDIT` — agent detail (real holders, snapshots, IPO status, best bid)
- `/agent/AUDIT/subscribe` — connect wallet → pay USDC → live audit with TEE-measurement verification badge
- `/agent/AUDIT/acquire` — real `Marketplace.postBid` / `accept` via wagmi, with USDC approval flow + testnet USDC mint button on 0G

## Sponsor stack

Each integration is **load-bearing** — pulling any one collapses the system to a centralized custodian.

| Sponsor | Role | Status |
|---|---|---|
| **0G** | iNFT (ERC-7857), Storage for sealed weights, Compute Sealed Executor | iNFT contract is a testnet stand-in; real ERC-7857 lands on the 0G fork. Storage + Compute SDK integration deferred (Ollama stand-in). |
| **Uniswap** | `pay-with-any-token` skill bridges x402 paywalls into swaps | x402 wired; pay-with-any-token integration is the next subscribe-page step |
| **Gensyn AXL** | P2P inference delivery — no centralized API gateway | bridge port stubbed; mesh integration deferred |
| **KeeperHub** | Revenue distribution workflow + ERC-8004 registration | RevenueVault.snap() ready; KeeperHub workflow YAML next |
| **ENS** | ENSIP-25 registry, CCIP-Read rotating addresses, subnames as revocable subscriber API keys | Resolver contract built + tested; gateway worker deferred |

## Hero agent

`auditor.stratum.eth` — a sealed Solidity audit agent.

- **Model:** qwen2.5-coder-32b + LoRA on Code4rena reports (1.5B for local dev)
- **Sealed in:** 0G Compute TEE Intel TDX (placeholder until SDK access)
- **Cost:** 1 USDC per audit
- **Output:** structured JSON findings with severity, location, suggested patch
- **Live:** tokenId 1 on 0G Galileo

## Documentation

The PRD set is in [`docs/`](docs). Start with [`00-master-prd.md`](docs/00-master-prd.md), then [`01-architecture.md`](docs/01-architecture.md).

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

- [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) — Intelligent NFT spec by 0G Foundation
- [0g-agent-nft](https://github.com/0gfoundation/0g-agent-nft) — Reference iNFT impl
- [Gensyn AXL](https://github.com/gensyn-ai/axl)
- [Uniswap pay-with-any-token](https://github.com/Uniswap/uniswap-ai)
- [KeeperHub](https://docs.keeperhub.com/)
- [ENS CCIP-Read](https://docs.ens.domains/)

## Contact

Project lead: kilianvaldman@gmail.com
