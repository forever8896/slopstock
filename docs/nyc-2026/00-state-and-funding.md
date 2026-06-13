# 00 — Live State, Funding Blocker, Addresses & Credentials

> **Single source of truth for "where are we right now."** Update this as things
> change. Everything verified as of **2026-06-13 (Fri night)** unless noted.

## What's verified DONE (all fund-free)

| Item | Status | Evidence |
|---|---|---|
| AUDIT brain decided | ✅ deepseek-v3-0324 on 0G mainnet, TeeML | smoke: 1.2s, correct output; 5.83 OG ≈ ~80 audits |
| "5.8 locked OG" mystery | ✅ RESOLVED — not stranded, it's the funded deepseek-v3 sub-account | inspect-0g-mainnet-ledger.ts |
| Walrus client | ✅ built + proven on testnet (JSON + binary + idempotent roundtrip) | `apps/operator/src/storage/walrus-client.ts`; live blob `SlKBeWlrC9dajMT4zlEDq9T5FsFJyx7Ze6tBXOmNvao` |
| CDP x402 facilitator creds | ✅ wired into `.env` (`CDP_API_KEY_ID`/`SECRET`, from obolos) | facilitator URL already `https://x402.coinbase.com` |
| Network switch (TDD) | 🟡 mid-cycle: `network.test.ts` written, failing RED correctly; `network.ts` not yet implemented | resume per [01-network-switch.md](01-network-switch.md) |
| Plans documented | ✅ this folder | — |

### Correction to an earlier assumption
AUDIT is **not** on weak qwen-7B today — it's on Venice `qwen3-coder-480b` (strong,
but centralized, not TEE-verified). The deepseek-v3 switch is therefore about making
the **attestation real** (sealed, TeeML, no placeholder), not a raw capability jump.
Flip is `.env` only: `BACKEND_BY_TOKEN_ID={"1":"0g-compute"}` +
`ZG_COMPUTE_PROVIDER_ADDRESS=0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0` (ensure the
0G compute backend uses the **mainnet** RPC `https://evmrpc.0g.ai`).

## THE BLOCKER: wallets are empty (only the user can clear this)

Funding required **before Saturday's selling window**. Nothing mainnet works without it.

| Send | To | For |
|---|---|---|
| ~0.01 ETH on **L1 mainnet** | deployer `0x2908209845Edd4B526B9F26E3b3bba73E9A59D10` | ENSIP-26 text-record writes (gas) |
| ~0.005 ETH on **Base** | deployer `0x2908…9D10` | contract deploys (tops up thin 0.00196) |
| ~0.005 ETH on **Base** | operator `0xAf2883b5F08298aaFD268552732250e10e71f414` + agent wallets | gas for USDC transfers |
| ~$5 **USDC** on **Base** | AUDIT wallet `0xc1Cba0Ed0B43EcB5aD1D9C39B21153972c33BF83` (+ a bit to ORCL) | outbound (Exa/CoinGecko) + agent-to-agent |

Total ≈ 0.02 ETH + $5 USDC (~$80). Fund AUDIT's wallet first — Dynamic `importPrivateKey`
keeps that address, so USDC stays put after the glow-up.

### Current balances (read 2026-06-13)
- deployer `0x2908…9D10`: Base ETH 0.00196, Base USDC 0, **L1 ETH 0**.
- operator `0xAf28…414`: Base ETH 0, Base USDC 0, L1 ETH 0.

## Wallets

| Role | Address | Key location |
|---|---|---|
| Deployer (owns slopstock.eth on **mainnet ENS**) | `0x2908209845Edd4B526B9F26E3b3bba73E9A59D10` | `.env` DEPLOYER_PRIVATE_KEY |
| Operator | `0xAf2883b5F08298aaFD268552732250e10e71f414` | `.env` OPERATOR_PRIVATE_KEY |
| Agent t1 AUDIT (deterministic) | `0xc1Cba0Ed0B43EcB5aD1D9C39B21153972c33BF83` | derived keccak(opkey+tokenId); → import to Dynamic |
| Agent t2 MEMER | `0xa22d9D1D92F2b7A3c772b9768FB27A4348DD3DfA` | derived |
| Agent t3 ORCL | `0x44e9f946d645cD795A7E19360C78e766a8B4c7f4` | derived |

## Key external addresses

| Thing | Address / value |
|---|---|
| Circle USDC Base **mainnet** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| TestnetUSDC (Base Sepolia, our permissionless mint) | `0xd44e0c3a9fa12e5c00c1714b51f4d8607962e603` |
| ERC-8004 IdentityRegistry — Base **mainnet** | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 ReputationRegistry — Base **mainnet** | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| ERC-8004 Identity — Base **Sepolia** | `0x8004A818...BD9e` (verify full addr before use) |
| ENS Registry (mainnet & Sepolia, same) | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| PublicResolver (Sepolia, current code) | `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5` (need mainnet resolver addr) |
| 0G Compute deepseek-v3-0324 (mainnet) | provider `0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0` |
| 0G Compute deepseek-v4-pro (mainnet) | `0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB` (~0.33 OG/audit) |
| 0G Compute deepseek-v4-flash (mainnet) | `0x61C0007197E7D4d6A842d6768E8035728877B9F6` (~12× cheaper) |

## Credentials (locations, never paste values)

- CDP x402 facilitator: `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` in `.env` (copied from `/home/deepseek/projects/obolos/.env`).
- Coinbase onramp (available in obolos if needed): `COINBASE_API_KEY`, `COINBASE_WEBHOOK_SECRET`.
- Dynamic: **TODO** — user to create env + API token via dashboard (`dyn` CLI installed). Will add `DYNAMIC_ENVIRONMENT_ID`, `DYNAMIC_AUTH_TOKEN`, `WALLET_PASSWORD` to `.env`.
- 0G compute ledger (mainnet): 0.5 OG available, 6.33 total (5.83 in deepseek-v3 sub-account, usable). Operator mainnet gas 0.997 OG.

## Helper scripts added this session (read-only unless noted)
- `apps/operator/scripts/inspect-0g-mainnet-ledger.ts` — per-provider mainnet balances (read-only).
- `apps/operator/scripts/smoke-0g-mainnet-deepseek.ts` — one real inference + cost (spends µOG).
- `apps/operator/scripts/list-0g-mainnet-readonly.ts` — list mainnet providers/models (read-only).
- `apps/operator/scripts/dump-0g-mainnet-prices.ts` — per-token pricing (read-only).
