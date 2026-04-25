# @stratum/operator

The agent operator node. Spec: [`../../docs/03-sealed-inference.md`](../../docs/03-sealed-inference.md) §9 and [`../../docs/06-axl-delivery.md`](../../docs/06-axl-delivery.md).

## What it does

For each agent the operator runs, this node:

1. Listens on the AXL mesh for incoming inference requests.
2. Serves MCP tools (`stratum.agent.{profile,quote,infer,attestation}`).
3. Verifies x402 payments and on-chain `authorizeUsage` grants.
4. Orchestrates inference inside the 0G Compute Sealed Executor.
5. Builds + signs `InferenceReceipt` objects (canonical schema in `@stratum/shared`).

## Layout

```
src/
├── index.ts          entrypoint
├── config.ts         env loader (zod)
├── mcp/
│   ├── server.ts     MCP server bootstrap
│   └── tools.ts      4 tool defs + handlers
├── http/
│   ├── server.ts     Bun.serve x402 gateway
│   └── x402.ts       402 builders + receipt validation
├── compute/
│   ├── client.ts     0G Compute (mock + real stub)
│   ├── receipt.ts    InferenceReceipt signer
│   └── types.ts
├── chain/
│   ├── clients.ts    viem clients for 0G + Base
│   └── abis.ts       hand-written ABI snippets
└── store/
    └── receipts.ts   in-memory receipt log (replaced by 0G Storage Log later)
```

## Run

```bash
bun install            # from repo root
cd apps/operator
cp ../../.env.example .env
# DEMO_MODE=true (default) short-circuits 0G Compute with deterministic output
bun dev
```

## Smoke test

```bash
# 1. health
curl -s http://127.0.0.1:8402/healthz
# → {"ok":true,"demoMode":true}

# 2. unpaid request → 402
curl -i -X POST http://127.0.0.1:8402/x402/infer \
  -H 'Content-Type: application/json' \
  -d '{"tokenId":42,"input":"contract X{}","subscriber":"0x1111111111111111111111111111111111111111"}'

# 3. paid request → 200 with full InferenceReceipt
curl -X POST http://127.0.0.1:8402/x402/infer \
  -H 'Content-Type: application/json' \
  -H 'X-PAYMENT-V1-RESPONSE: {"txHash":"0xdeadbeef","facilitator":"demo","receiptId":"rcpt-001"}' \
  -d '{"tokenId":42,"input":"contract X{ ... }","subscriber":"0x1111111111111111111111111111111111111111"}'
```

## Demo mode vs real mode

`DEMO_MODE=true` (default) short-circuits two things:

1. **0G Compute**: returns a pre-canned audit-shaped JSON output instead of calling the Sealed Executor. The receipt's TEE quote is a base64 placeholder labeled `demo-mode-tee-quote-not-real`.
2. **x402 facilitator**: accepts any non-empty `receiptId` instead of validating against the real facilitator.

The rest of the pipeline (input/output hashing, receipt construction + signing, MCP tool dispatch, on-chain `authorizeUsage` checks if `AGENT_NFT_ADDRESS` is set) is real. Flip `DEMO_MODE=false` once the 0G Compute proxy URL + auth model is wired up.

## Status

- [x] MCP server with 4 tools (profile, quote, infer, attestation)
- [x] x402 HTTP gateway with proper 402 challenge + receipt validation
- [x] Mock 0G Compute returning shaped output + fake attestation
- [x] InferenceReceipt builder + ECDSA signer
- [x] viem clients for 0G + Base
- [ ] AXL daemon child process + MCP-over-HTTP transport
- [ ] Real 0G Compute Sealed Executor integration
- [ ] Real x402 facilitator integration
- [ ] On-chain `authorizeUsage` grant after successful payment
- [ ] 0G Storage Log writer (replace in-memory receipt store)
