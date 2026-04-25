# @stratum/gateway

Cloudflare Worker — ENS CCIP-Read gateway for `*.stratum.eth`.

Spec: [`../../docs/05-ens-identity.md`](../../docs/05-ens-identity.md) §3.

## What it does

- Receives offchain ENS lookups (EIP-3668) from clients.
- Computes the answer for `addr`, `text`, etc.
- Signs the response with `GATEWAY_SIGNER_KEY` so the on-chain `StratumResolver` can verify.
- Implements **rotating treasury addresses** for `treasury.<agent>.stratum.eth`.
- Gates **subscriber subnames** on the on-chain `authorizeUsage` grant.

## Deploy

```bash
bunx wrangler login
bunx wrangler secret put GATEWAY_SIGNER_KEY
bunx wrangler secret put AGENT_REGISTRY_URL
bun deploy
```

## Status

Stub.
