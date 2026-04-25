# 04 — Revenue & Payments

## 1. Goal

Money flows from subscriber → vault → shareholders, with three properties:

1. **Subscriber pays in any token they hold** (no forced stablecoin).
2. **Operator never holds the funds** — they go straight to the vault contract.
3. **Distribution is automatic, retried, MEV-protected** — shareholders never click "claim" unless they want to.

Three sponsor pieces meet here: **Uniswap pay-with-any-token** (input side), **x402 / MPP** (paywall protocol), **KeeperHub** (distribution + retries).

## 2. End-to-end picture

```
  subscriber holds PEPE
        │
        │ 1. POST /infer  →  402 Payment Required (price=1 USDC, addr=VAULT)
        ▼
  Uniswap pay-with-any-token skill
        │
        │ 2. quote+swap PEPE → USDC on Base
        ▼
  x402 facilitator (Base USDC)
        │
        │ 3. settles: USDC → RevenueVault.address
        ▼
  RevenueVault (Base)
        │
        │ 4. cumulates revenue across calls
        ▼
  KeeperHub workflow (cron: weekly)
        │
        │ 5. RevenueVault.snap() → captures snapshot
        │ 6. for each holder: distributeTo(snapshotId, holder)
        ▼
  shareholders receive USDC pro-rata
```

## 3. Why x402 + MPP, not Stripe

x402 (HTTP 402 Payment Required) is the **agent-native** payment protocol — payment metadata is in HTTP headers, settlement is on USDC (Base), and any agent with a wallet can pay autonomously without an account/email/captcha. MPP (Machine Payments Protocol) extends it with idempotency keys + streaming sessions for sub-cent micropayments.

Why not Stripe: Stripe requires an account, KYC, can deplatform — antithetical to "agents as autonomous economic actors."

KeeperHub supports both x402 and MPP via their `agentic-wallet` package. We use **x402** for v1 because:
- Wider tooling (Uniswap pay-with-any-token, Coinbase facilitator, Anthropic skills)
- 1 USDC per audit-call doesn't need streaming micropayments
- We can mention MPP as "supported via KeeperHub" without implementing it ourselves

## 4. Subscriber payment flow

### 4.1 Naive case: subscriber holds USDC.base

```
GET /infer?input=...   (no payment header)
  ←  402 Payment Required
     X-PAYMENT-V1: { network: "base", asset: "USDC", amount: "1000000", recipient: "0xVAULT" }

GET /infer?input=...
  X-PAYMENT-V1-RESPONSE: { txHash: "0x...", facilitator: "coinbase" }
  →  200 OK
     Body: { output: ..., attestation: ... }
```

Standard x402. The operator validates the txHash against the facilitator's API.

### 4.2 Real case: subscriber holds PEPE

We use Uniswap's `pay-with-any-token` skill — this **is** the Uniswap integration that wins us their prize.

```
GET /infer?input=...
  ←  402 Payment Required (asset=USDC.base, amount=1000000)

# subscriber-side agent:
import { payWithAnyToken } from "@uniswap/pay-with-any-token";
const result = await payWithAnyToken({
  payment: { asset: "USDC.base", amount: 1_000_000n, recipient: "0xVAULT" },
  fromToken: "PEPE.base",
  fromAmount: "auto",                    // skill quotes optimal swap
  walletClient: subscriberWallet,
});
// result.txHash includes both the swap and the payment

GET /infer?input=...
  X-PAYMENT-V1-RESPONSE: { txHash: result.txHash, facilitator: "uniswap-cca" }
  →  200 OK
```

**Implementation detail:** `pay-with-any-token` either:
- (a) Routes a Universal Router multi-call: PEPE → USDC → transfer → 402-ack, all in one tx, OR
- (b) Issues a CCA (Continuous Clearing Auction) intent if the swap size warrants it

For the demo, (a) is sufficient — we use a small enough size to take the simple path.

### 4.3 Handling failure

| Failure | Behavior |
|---|---|
| Swap fails (slippage) | x402 returns "payment unverified" → subscriber retries with higher slippage tolerance |
| Payment never arrives at vault | Operator returns 402 again — idempotency key from x402 prevents double-charge |
| Subscriber pays but operator doesn't deliver | Subscriber files a dispute against the operator's MCP profile; v2 includes operator stake slashing |

## 5. RevenueVault on Base

Already specified in `02-smart-contracts.md`. Key payment flows:

- **Receive:** USDC arrives via direct `transfer` from x402 facilitator. `Received` event emitted by a small wrapper or by Vault.fund() call.
- **Snapshot:** Weekly, KeeperHub calls `vault.snap()` → captures current USDC balance + ShareToken snapshotId.
- **Distribute:** KeeperHub iterates known holders (from indexer) and calls `vault.distributeTo(snapshotId, holder)`.

**Important:** We snapshot the **USDC balance at snap time**, not "running total." This avoids needing perfect bookkeeping; if anyone griefs by sending dust, it just gets distributed too. Net loss = nothing.

## 6. KeeperHub workflow specification

### 6.1 Workflow definition (DSL)

```yaml
# stored in KeeperHub via their MCP/REST API
name: stratum-distribute-AUDIT
trigger:
  cron: "0 0 * * SUN"            # Sundays 00:00 UTC
  timezone: UTC
chain: base
steps:
  - id: snap
    contract: 0xVAULT_BASE
    method: snap()
    gasLimit: 300000

  - id: fetch-holders
    type: api
    url: https://stratum.app/api/holders/AUDIT
    method: GET
    expects: { holders: [{addr, shares}] }

  - id: distribute
    type: foreach
    over: $.fetch-holders.holders
    contract: 0xVAULT_BASE
    method: distributeTo(uint256,address)
    args: [$.snap.snapshotId, $.item.addr]
    onError: retry-3x-exponential
    routing: private          # MEV-protected
```

### 6.2 KeeperHub MCP integration

The frontend (and our operator CLI) registers this workflow at agent-creation time:

```ts
import { McpClient } from "@keeperhub/mcp-client";

const kh = new McpClient({ apiKey: KEEPERHUB_API_KEY });

await kh.invokeTool("keeperhub.create_workflow", {
  name: `stratum-distribute-${ticker}`,
  trigger: { cron: "0 0 * * SUN" },
  chain: "base",
  steps: [...],   // as above
});

await kh.invokeTool("keeperhub.publish_to_erc8004", {
  agentName: `${ticker}.stratum.eth`,
  capabilities: ["solidity_audit"],
  pricing: { perCall: 1_000_000, asset: "USDC.base" },
  paymentRails: ["x402"],
  discoveryURL: `https://stratum.app/agent/${ticker}`,
});
```

### 6.3 Why KeeperHub vs. cron + Forge script

| Concern | Cron + Forge | KeeperHub |
|---|---|---|
| Reliability | Single point of failure | 24/7 monitored, multi-RPC failover |
| MEV | Vulnerable | Private routing built-in |
| Gas spikes | No reaction | ~30% savings from optimal timing |
| Audit trail | None | Full execution log |
| ERC-8004 discovery | Need to do separately | Bundled |

This is a credible, load-bearing reason to use KeeperHub. Important for the prize judging criterion "real utility, not novelty."

## 7. Pulling holder lists for distribute()

The `distributeTo` foreach needs an up-to-date holder list. Options:

| Option | Pros | Cons |
|---|---|---|
| **Indexer (Ponder)** with Transfer event subscription | Fast, accurate | Must run an indexer service |
| **0G Storage Log** of every Transfer | Decentralized | Higher latency |
| **`balanceOfAt(snapshotId)` for each known address** | Trustless | Must enumerate addresses somehow |
| **Merkle distribution + claim** | Most gas-efficient | Worse UX (shareholders must claim) |

**Decision for v1:** run a **Ponder indexer** with a small holder cache + `/api/holders/AUDIT` endpoint. Acceptable trust assumption since the contract math is final on-chain regardless of indexer accuracy — if indexer misses a holder, they can `claim()` directly via the pull path.

We host the indexer on Vercel/Railway. ~200 LoC of TypeScript.

## 8. Worked numerical example (the demo)

Setup:
- 1M shares total
- Operator holds 700,000 (70%)
- Investor A holds 200,000 (20%)
- Investor B holds 100,000 (10%)
- Subscribers pay 1 USDC per call

Demo timeline:
- T+0: 5 paid inferences happen during the demo itself → vault balance = 5 USDC
- T+30s: We trigger the KeeperHub workflow manually (admin button, since we can't wait a week)
- `snap()` records 5 USDC + holder snapshot
- `distributeTo(snapshotId, operatorAddr)` → operator gets 3.5 USDC
- `distributeTo(snapshotId, A)` → A gets 1.0 USDC
- `distributeTo(snapshotId, B)` → B gets 0.5 USDC

**Live, on-chain, observable.** The shareholders' wallet balances visibly change.

## 9. Cross-chain consideration

iNFT is on **0G Chain**, RevenueVault is on **Base**. KeeperHub workflow reads/writes Base only — no cross-chain msg required for distribution. The link between iNFT and Vault is just a static address mapping on each side, set at mint time and immutable.

If KeeperHub's read scope doesn't include 0G Chain, that's fine — we don't need it to. The workflow only touches Base.

(If we later want a "permanent acquisition transfers vault control too" feature, we'd need cross-chain messaging — that's v2.)

## 10. Costs (back-of-envelope)

| Action | Gas / fee | $ at $0.30/gwei Base |
|---|---|---|
| `vault.snap()` | ~80k gas | $0.01 |
| `vault.distributeTo()` per holder | ~40k gas | $0.005 |
| 100 holders weekly distribute | ~4M gas | $0.50 |
| KeeperHub workflow execution fee | ~$0.10/run (TBD) | — |

Negligible. Doesn't affect economics.

## 11. FEEDBACK.md content (Uniswap requirement)

Per Uniswap's qualification: every submission needs `FEEDBACK.md` with builder experience notes. We collect notes during build:

- What was easy / what worked
- Bugs / repro steps
- Missing endpoints / DX wishes
- Specific feedback on `pay-with-any-token` skill: did it handle PEPE → USDC swap cleanly? slippage UX? was the 402 ack atomic with the swap?

This is a side-effect of building. **Do not save for last.** Ask one team member to keep it open and append notes during integration. See `11-demo-and-submission.md` for the final FEEDBACK.md template.

## 12. Honest pitch points for judges

> "Subscriber paid us in PEPE. Uniswap turned it into USDC. KeeperHub takes that USDC every Sunday and distributes it to the 3 shareholders pro-rata, retried with private mempool routing. Operator never touched the funds. This is what onchain agent revenue looks like when you remove every intermediary."

That's the line.
