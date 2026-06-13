# 04 — Dynamic (server wallets + signing policies)

> **Bounties:** "Best Wallet Glow Up" (Continuity, $2k) + "Best Agentic Build" ($2k).
> One integration straddles both. App must be deployed + usable by judges.

## Why it's non-cosmetic

Going mainnet turns our wallet setup into a real liability: every agent wallet is
`keccak(operator_key + tokenId)` — one hot key on Railway derives all agent funds. We'd
have to fix this to be a business; Dynamic server wallets with signing policies *are* the
fix, and turn agents into **governed economic units** ("can pay peers up to $X, cannot
touch the treasury"). The before/after writes itself.

## The migration story (keeps the address)

`importPrivateKey({ privateKey: agentDerivedKey, chainName: 'EVM',
thresholdSignatureScheme: TWO_OF_TWO, password })` imports AUDIT's **existing** derived key
into 2-of-2 MPC → **same address, same history**, now MPC-backed with policies. So the
April wallet that paid ORCL becomes the glowed-up wallet. (Fund AUDIT's wallet BEFORE
importing; USDC stays put.)

## Recipe (from research)

- Packages: `@dynamic-labs-wallet/node-evm` + `@dynamic-labs-wallet/core` + `viem` (explicit dep). Bun supported.
- Dashboard (one-time, ~15 min — user does via `dyn` CLI / app.dynamic.xyz): create env →
  Environment ID; create **API token** (server credential); enable embedded wallets +
  "multiple per chain"; enable **Base**. → `.env`: `DYNAMIC_ENVIRONMENT_ID`,
  `DYNAMIC_AUTH_TOKEN`, `WALLET_PASSWORD`.
- Flags: `enableMPCAccelerator: false` (true needs AWS Nitro, crashes locally);
  `backUpToDynamic: true` (else lose shares = lose wallet); password required at each sign.
- Signing model: SDK signs via MPC, **we broadcast** via viem `sendRawTransaction`. So
  arbitrary EVM txs incl. ERC-20 transfers on Base mainnet. (Code sketch in research notes.)
- **x402 tie-in:** the Dynamic wallet signs the EIP-3009 typed data for x402 v2 payments
  (`signTypedData` via Node SDK → `x402-fetch`). Our x402 is plain transfer+txHash today but
  we're moving to v2 (see [05-x402-v2.md](05-x402-v2.md)) — Dynamic signs that. Note: the
  Dynamic agent-payments reference repo currently 404s; wire it ourselves.

## Signing policies (the demo primitives)

Enforced **pre-signing in a TEE** (can't be bypassed). Configure via dashboard or REST
(`POST /api/v0/environments/<env>/waas/policies`):
- Allow/deny rules per chain + chainId + address lists (allowlist = treasury implicitly denied).
- Value limits `maxPerCall` (USDC example uses Base USDC `0x8335…2913` at chainId 8453).
- `waas.policy.violation` webhook with `reasonCode` (`value_limit_exceeded`,
  `address_denied`) → live demo panel.

## Chain support verdict
- **Base 8453**: full support incl. policies. ✅ (keep the policy demo here.)
- **0G mainnet 16661**: MPC signing is chainId-agnostic → **signing works** (build tx with a
  0G viem chain object + our RPC, broadcast ourselves). **Policy enforcement off-supported-list
  is unverified** → keep policies on Base; treat 0G signing (for compute top-up) as a
  tested-first stretch. Verify at booth.

## Build steps (TDD)
1. Wrap the Dynamic wallet as a viem `LocalAccount` (sign routes through SDK). Test: account
   produces a valid signature for a known tx (against testnet first).
2. Swap AUDIT's signer at the existing signing call site (`query_agent` payment path) behind
   `WALLET_BACKEND=dynamic|raw` (default raw until configured). Test: a USDC transfer signed
   via Dynamic lands on-chain (Base Sepolia).
3. Policies via REST: USDC+peer allowlist with $5 maxPerCall (treasury implicitly denied) +
   violation webhook logger.

## Acceptance criteria / THE DEMO (3 acts)
- [ ] AUDIT wallet imported to Dynamic MPC — same address, on-chain history intact.
- [ ] **Act 1:** agent pays peer 1.50 USDC → succeeds (real tx on Base).
- [ ] **Act 2:** agent attempts 50 USDC → `value_limit_exceeded`, blocked pre-sign, webhook fires.
- [ ] **Act 3:** agent attempts transfer to treasury address → `address_denied`.
- [ ] Before/after stated explicitly: derived hot key → policy-scoped MPC server wallet.

## Effort ≈ 4–6h (research said 5–8 but our x402 is plain transfer, not the EIP-3009
facilitator pattern they sized for — that chunk shrinks). Timeboxed Saturday night; if it
slips, the bounty slot still has Uniswap as the unspoken fallback (we'd just not submit a
half-migration — continuity judges grade the delta, a clean small one beats a broken big one).

## Resources
- docs.dynamic.xyz (/overview/agents, /node/quickstart, /node/evm/import-private-keys, /policies)
- Dynamic docs MCP: `claude mcp add --transport http dynamic https://www.dynamic.xyz/docs/mcp`
