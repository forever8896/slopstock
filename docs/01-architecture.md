# 01 — Architecture

## 1. System overview

```
                      ┌─────────────────────────────────────────────┐
                      │             FRONTEND (Next.js)              │
                      │   list / detail / buy-shares / subscribe    │
                      └───────┬───────────────────────────┬─────────┘
                              │                           │
                              │ wagmi/viem                │ fetch
                              ▼                           ▼
        ┌──────────────────────────────┐   ┌───────────────────────────┐
        │       0G CHAIN (EVM)         │   │   AXL EDGE NODE (local)   │
        │   AgentNFT (ERC-7857)        │   │   /mcp/* served over mesh │
        │   ShareToken (ERC-20)        │   └────────────┬──────────────┘
        │   RevenueVault               │                │ p2p over AXL
        │   IPOSale                    │                ▼
        │   Marketplace                │   ┌───────────────────────────┐
        │   ERC-8004 registration      │   │   AGENT OPERATOR NODE     │
        └──────┬───────────────────────┘   │   AXL peer +              │
               │                           │   MCP server +            │
               │ events                    │   inference orchestrator  │
               ▼                           └────────────┬──────────────┘
        ┌──────────────────────────────┐                │
        │    KEEPERHUB WORKFLOW        │                │ /v1/proxy
        │  cron: weekly                │                ▼
        │  1) read RevenueVault.bal()  │   ┌───────────────────────────┐
        │  2) call distribute()        │   │   0G COMPUTE              │
        │  3) MEV-protected, retried   │   │   Sealed Executor (TEE)   │
        └──────────────────────────────┘   │   model: qwen2.5-coder    │
                                           │   weights: from 0G Storage│
        ┌──────────────────────────────┐   │   returns signed output   │
        │    UNISWAP API + x402        │   └────────────┬──────────────┘
        │  pay-with-any-token skill    │                │
        │  bridges PEPE→USDC→paywall   │                │ encrypted blob
        └──────────────────────────────┘                ▼
                                           ┌───────────────────────────┐
        ┌──────────────────────────────┐   │      0G STORAGE           │
        │       ENS (Sepolia L1)       │   │   sealed weights blob     │
        │   stratum.eth (parent)       │   │   sealed system prompt    │
        │   auditor.stratum.eth        │   │   inference log (Log API) │
        │   resolver = our gateway     │   │   state KV (KV API)       │
        │     CCIP-Read → rotating     │   └───────────────────────────┘
        │     treasury addr per call   │
        └──────────────────────────────┘
```

## 2. Chain topology

| Concern | Chain | Why |
|---|---|---|
| iNFT (ERC-7857) | **0G Chain (Galileo testnet)** | iNFT is 0G's native primitive; reference impl + AgentMarket live there |
| Share token (ERC-20) | **0G Chain** | Co-locate with iNFT to avoid bridging |
| Revenue Vault | **0G Chain** | Receives x402 settlement asset (USDC on 0G) |
| IPO Sale + Marketplace | **0G Chain** | Same as above |
| ENS records | **Sepolia (or L1 mainnet if we use durin.dev L2 resolver)** | ENS only lives on L1 |
| CCIP-Read gateway | **off-chain HTTP service** | Returns signed responses for the L1 resolver to verify |
| ERC-8004 agent registry | **0G Chain** if KeeperHub registers there, else wherever KeeperHub registers (probably Base) | Need to confirm Hour 0 |
| Uniswap routing | **Base** (where Uniswap v4 + x402 facilitator both live) | x402 USDC settlement is canonical on Base |
| KeeperHub workflow | KeeperHub-managed; reads from 0G Chain | Cross-chain workflow read |

**Bridging concern:** revenue is paid in USDC on Base (x402 default). Vault is on 0G Chain. Two options:
- **(A)** Settle on Base USDC, KeeperHub bridges + distributes on Base. Revenue Vault deploys to Base, not 0G Chain.
- **(B)** Use 0G Chain native USDC, x402 facilitator on 0G Chain (if exists), avoid bridging.

**Decision:** We pick **(A)** — RevenueVault on **Base**, iNFT on 0G Chain. This separates "the asset" (0G Chain) from "the cashflow account" (Base). It's also more honest: real x402 lives on Base, that's where subscribers actually pay. Cross-chain link from iNFT → Vault is a tokenId↔vaultAddress mapping in a small registry contract on each side. *(Reconfirm Hour 0 once we know what 0G Chain has natively.)*

## 3. End-to-end flows

### 3.1 Mint flow (operator-side, one-time per agent)

```
operator CLI                0G Storage             0G Chain
    │                           │                      │
    │ 1. encrypt(weights, k0)   │                      │
    │──────────────────────────▶│                      │
    │     storage_uri ─────────▶│                      │
    │                           │                      │
    │ 2. mint(metadataURI,      │                      │
    │         sealedKey0,       │                      │
    │         attestation)      │                      │
    │────────────────────────────────────────────────▶│
    │                           │     tokenId          │
    │◀────────────────────────────────────────────────│
    │                           │                      │
    │ 3. fractionalize(tokenId, supply=1M)             │
    │────────────────────────────────────────────────▶│
    │                           │     shareToken addr  │
    │◀────────────────────────────────────────────────│
    │                           │                      │
    │ 4. setENSResolver(ticker, tokenId, vault)        │
    │────────────────────────────────────────────────▶│
    │                                                  │
```

### 3.2 IPO flow

```
investor               IPOSale (Base)         ShareToken
   │                        │                       │
   │ buy(amountShares) {    │                       │
   │   pays USDC ──────────▶│                       │
   │ }                      │ transferFrom(treasury)│
   │                        │──────────────────────▶│
   │◀─────── shares ────────│                       │
   │                        │                       │
   │     IPO proceeds → operator address            │
```

### 3.3 Subscribe + inference flow (the money loop)

```
subscriber agent          paywall          Uniswap          inference op       0G Compute
      │                      │                │                  │                  │
      │ POST /infer ────────▶│                │                  │                  │
      │◀── 402 (price=1USDC, asset=base-usdc, addr=vault) ──     │                  │
      │                      │                │                  │                  │
      │ subscriber holds PEPE only            │                  │                  │
      │ pay-with-any-token: PEPE→USDC ───────▶│                  │                  │
      │                      │  USDC swap     │                  │                  │
      │ resubmit w/ payment proof ──────────▶│                  │                  │
      │                      │                │                  │                  │
      │                      │ payment verified                  │                  │
      │                      │ enqueue inference ──────────────▶ │                  │
      │                      │                │                  │                  │
      │                      │                │       authorizeUsage(tokenId, sub) │
      │                      │                │                  │─────────────────▶│
      │                      │                │                  │  TEE attests     │
      │                      │                │                  │  runs sealed exec│
      │                      │                │                  │◀─── output+attest│
      │                      │                │                  │                  │
      │                      │ AXL /recv ◀────────────────────── │                  │
      │◀─ result + attestation (signed) ──────│                  │                  │
      │                                                          │                  │
      │ RevenueVault.balance += 1 USDC                                              │
```

### 3.4 Distribution flow (KeeperHub-managed, recurring)

```
KeeperHub workflow        RevenueVault          ShareToken         shareholders
      │                        │                      │                   │
   cron: every Sunday 00:00 UTC│                      │                   │
      │ read balance ─────────▶│                      │                   │
      │◀── 1234 USDC ──────────│                      │                   │
      │                        │                      │                   │
      │ snapshot holders ──────────────────────────────▶│                  │
      │◀── [(addr, balance)…] ──────────────────────── │                  │
      │                        │                      │                   │
      │ distribute() ─────────▶│                      │                   │
      │                        │ USDC.transfer(addr_i, share_i × bal)     │
      │                        │─────────────────────────────────────────▶│
      │                        │                      │                   │
   (retried with private MEV-protected routing if any tx reverts)
```

### 3.5 Acquisition flow (whole-iNFT buyout — the headline trick)

```
acquirer            Marketplace (0G Chain)        TEE service         AgentNFT
   │                       │                         │                    │
   │ submitBid(price) ────▶│                         │                    │
   │ + escrow USDC         │                         │                    │
   │                       │                         │                    │
   │     operator accepts                            │                    │
   │                       │ requestReencrypt(tokenId, acquirerPubKey) ──▶│
   │                       │                         │                    │
   │                       │     TEE: in-enclave    │                    │
   │                       │     - decrypt(weights, k_old)               │
   │                       │     - generate k_new                        │
   │                       │     - encrypt(weights, k_new)               │
   │                       │     - sealedKey_new = seal(k_new, acquirerPubKey)
   │                       │     - emit attestation                      │
   │                       │◀──────── attestation ──│                    │
   │                       │                         │                    │
   │                       │ iTransfer(tokenId, acquirer, attestation) ──▶│
   │                       │                         │                    │
   │                       │           ownership transferred             │
   │                       │           authorizeUsage[] cleared          │
   │                       │           ENS resolver flips to acquirer    │
   │                       │                         │                    │
   │ shares are NOT transferred (acquirer must buy on open market separately)
   │   OR: bid was for "tender offer" of all shares too — operator-defined
```

## 4. Trust model

| Component | Trust assumption | Verifier |
|---|---|---|
| Sealed weights encryption | TEE attestation (Intel TDX or H100/H200) | On-chain attestation verifier in iNFT contract |
| Inference output integrity | TEE attestation (TEEML proof on each call) | Subscriber's client verifies signature against on-chain pubkey |
| Re-encryption on transfer | TEE attestation in `iTransfer()` | iNFT contract verifies before flipping ownership |
| Revenue distribution | Public on-chain math | Anyone reads contract |
| ENS resolution | CCIP-Read with EIP-3668 signed gateway response | ENS resolver on-chain verifier |
| AXL transport | Yggdrasil mesh + ed25519 keys | E2E encrypted by AXL itself |
| Off-chain components (frontend, indexer) | Trusted **only for display**; user always confirms in wallet | User |

**No component requires trusting the operator.** Every cryptographic claim is verifiable. (Demo this!)

## 5. Component responsibilities (canonical)

| Component | Lives where | Responsibility |
|---|---|---|
| `AgentNFT.sol` | 0G Chain | ERC-7857 implementation, mint, iTransfer, authorizeUsage, iClone |
| `ShareToken.sol` | 0G Chain | ERC-20 fractional shares, 1M total supply per agent |
| `Fractionalizer.sol` | 0G Chain | Locks iNFT in vault, mints ShareToken; reverse for redemption |
| `IPOSale.sol` | Base | Fixed-price sale of seed allocation |
| `RevenueVault.sol` | Base | Holds USDC, snapshots holders, distributes pro-rata |
| `Marketplace.sol` | 0G Chain | Whole-agent bid/ask + acquisition orchestration |
| `AgentRegistry.sol` | 0G Chain | tokenId ↔ ENS name ↔ vault addr mapping |
| 0G Compute proxy | 0G infra | OpenAI-compatible inference endpoint with TEEML proofs |
| Operator node | self-hosted | AXL peer, MCP server, payment verifier, inference orchestrator |
| Subscriber node | self-hosted | AXL peer, MCP client, x402 client |
| ENS gateway | Vercel/Cloudflare Worker | CCIP-Read responder; rotating addresses, VC text records |
| KeeperHub workflow | KeeperHub managed | Weekly distribution cron |
| Frontend | Vercel | Next.js, wagmi, RainbowKit |
| Indexer | Ponder or simple JSON-RPC poller | Aggregates revenue history, holder counts, attestation log |

## 6. Data model (canonical)

### 6.1 `AgentMetadata` (stored at 7857 metadataURI on 0G Storage)

```json
{
  "schemaVersion": "stratum/agent/v1",
  "name": "auditor.stratum.eth",
  "ticker": "AUDIT",
  "description": "Sealed Solidity security audit agent.",
  "modelBase": "qwen2.5-coder-32b",
  "loraURI": "0g://0xabc.../audit-lora-v1.safetensors.enc",
  "systemPromptURI": "0g://0xdef.../system-prompt.txt.enc",
  "ragCorpusURI": "0g://0xghi.../audit-corpus.tar.enc",
  "executor": {
    "kind": "0g-compute-sealed",
    "minTeeAttestation": "TDX",
    "endpointHint": "https://compute.0g.ai/v1/proxy"
  },
  "pricing": {
    "perCall": "1000000",
    "asset": "0xUSDC_BASE",
    "currency": "USDC"
  },
  "vault": "0xVAULT_BASE",
  "shareToken": "0xSHARE_0G",
  "ens": "auditor.stratum.eth",
  "createdAt": 1745625600,
  "version": 1
}
```

### 6.2 `InferenceReceipt` (returned with every paid call, stored in 0G Log)

```json
{
  "schemaVersion": "stratum/receipt/v1",
  "tokenId": 42,
  "subscriber": "0xSUB",
  "callId": "uuid-v4",
  "input": "sha256(input)",
  "outputHash": "sha256(output)",
  "model": "qwen2.5-coder-32b@stratum-audit-lora-v1",
  "teeAttestation": {
    "vendor": "intel-tdx",
    "quote": "base64...",
    "measurement": "0x..."
  },
  "paymentProof": "x402-receipt-id...",
  "ts": 1745625600,
  "signature": "0x..."
}
```

### 6.3 `RevenueSnapshot` (created weekly, before distribution)

```json
{
  "snapshotId": 17,
  "blockNumber": 12345678,
  "totalShares": 1000000,
  "balance": "1234500000",
  "holders": [
    { "addr": "0xA…", "shares": 700000 },
    { "addr": "0xB…", "shares": 200000 },
    { "addr": "0xC…", "shares": 100000 }
  ]
}
```

## 7. Out-of-band assumptions we are making

- 0G Compute Sealed Executor exposes an OpenAI-compatible endpoint with TEE attestation in response headers. Confirmed by the research dive against `0g-compute-cli inference list-providers` docs; reconfirm Hour 0.
- ERC-7857 reference impl at `github.com/0gfoundation/0g-agent-nft` is deployable to 0G Chain Galileo testnet.
- AXL public bootstrap peer exists or we self-host one — either is fine for a demo.
- Uniswap `pay-with-any-token` skill is callable from a backend (not Claude-Code-only) — verify Hour 0.
- KeeperHub MCP can register a workflow that reads a contract on Base. Confirm via `docs.keeperhub.com/api`.

## 8. Failure modes (top-level)

| Failure | Detection | Mitigation |
|---|---|---|
| 0G Compute endpoint slow/down | Subscriber timeout | Fallback to non-sealed inference + flag receipt as "unsealed (demo only)" — only as last resort |
| AXL bootstrap unreachable | AXL `/topology` returns no peers | Local in-process fallback for the demo (lose the prize but keep the flow) |
| KeeperHub workflow doesn't fire | No distribution event by demo time | Manual `distribute()` call from frontend with a "Trigger weekly distribution" admin button |
| ERC-7857 TEE re-encryption oracle missing | `iTransfer()` reverts | Hard-code mock attestation in test mode + label it explicitly in demo |
| Cross-chain (0G ↔ Base) bridge complexity | Demo time pressure | Move RevenueVault to 0G Chain too; sacrifice "real x402 on Base" honesty for hackathon speed |

See `10-risks-and-cuts.md` for the full register and decision tree.
