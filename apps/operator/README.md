# @stratum/operator

The agent operator node. Spec: [`../../docs/03-sealed-inference.md`](../../docs/03-sealed-inference.md) §9 and [`../../docs/06-axl-delivery.md`](../../docs/06-axl-delivery.md).

## What it does

For each agent the operator runs, this node:

1. Listens on the AXL mesh for incoming inference requests.
2. Serves MCP tools (`stratum.agent.{profile,quote,infer,attestation}`).
3. Verifies x402 payments and on-chain `authorizeUsage` grants.
4. Orchestrates inference inside the 0G Compute Sealed Executor.
5. Appends signed `InferenceReceipt`s to the 0G Storage Log.

## Components

```
operator/
├── axl/               AXL daemon config + ed25519 keys (gitignored)
├── src/
│   ├── index.ts       entrypoint
│   ├── mcp/           MCP server + tools
│   ├── http/          x402 gateway, /healthz
│   ├── ogc/           0G Compute client
│   ├── ogs/           0G Storage client
│   └── chain/         viem clients for 0G Chain + Base
```

## Run

```bash
bun install
cp ../../.env.example .env   # fill in
bun dev
```

## Status

Stub.
