# 01 — Network Switch (testnet ↔ mainnet) + TDD Foundation

> **Goal:** flipping the entire stack between testnet and mainnet is **one env var**.
> No hand-edited addresses under demo pressure. Built test-first.

## The problem today

- `packages/shared/src/addresses.ts` bakes the network into names: `USDC_BASE_SEPOLIA`,
  `BASE_SEPOLIA_AGENTS`, `ZG_GALILEO`. Mainnet would need parallel constants + rewiring
  every importer.
- Chain values are scattered: some in `config.ts` env (`BASE_RPC_URL`, `BASE_CHAIN_ID`,
  `ZG_RPC_URL`…), some hardcoded in `addresses.ts`, `baseSepolia` hardcoded in
  `apps/operator/src/chain/clients.ts`.
- **Zero TypeScript tests exist** (only contracts have forge tests). `bun test` is the
  runner (each workspace `"test": "bun test"`).

## The design: `getNetwork()`

One module, `packages/shared/src/network.ts`. `resolveNetwork(env)` reads `env.NETWORK`
(`testnet` default | `mainnet`), returns a **frozen** `NetworkConfig` with every
chain-specific value. Env RPC overrides win over baked defaults. Unknown value throws.

```ts
export type NetworkName = "testnet" | "mainnet";
export interface NetworkConfig {
  name: NetworkName;
  base:    { chainId: number; rpcUrl: string; usdc: Hex };
  zg:      { chainId: number; rpcUrl: string; computeRpcUrl: string };
  ens:     { chainId: number; rpcUrl: string; registry: Hex; resolver: Hex; rootName: string };
  erc8004: { identityRegistry: Hex; reputationRegistry: Hex };
  x402:    { facilitatorUrl: string; network: string }; // network = "base" | "base-sepolia"
  agents:  Record<string, AgentAddresses>;              // per-network bundle
}
export function resolveNetwork(env: Record<string,string|undefined>): NetworkConfig;
export function getNetwork(): NetworkConfig; // memoized resolveNetwork(process.env)
```

### Values per network
| field | testnet | mainnet |
|---|---|---|
| base.chainId | 84532 | 8453 |
| base.usdc | `0xd44e…962e603` (TestnetUSDC) | `0x8335…02913` (Circle) |
| zg.chainId | 16602 | 16661 |
| zg.computeRpcUrl | (testnet) | `https://evmrpc.0g.ai` |
| ens.chainId | 11155111 | 1 |
| ens.rootName | slopstock.eth | slopstock.eth |
| erc8004.identityRegistry | Base Sepolia `0x8004A818…` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| x402.facilitatorUrl | `https://x402.org/facilitator` (keyless) | `https://x402.coinbase.com` (CDP) |
| x402.network | `base-sepolia` | `base` |

### Migration approach (low-risk, additive)
1. Build `network.ts` test-first (pure function — trivial to TDD).
2. Existing `addresses.ts` constants stay but become **derived from `resolveNetwork('testnet')`**
   so current code keeps working unchanged while we migrate call sites to `getNetwork()`.
3. Migrate call sites incrementally: `clients.ts` (drop hardcoded `baseSepolia`),
   `query_agent`, x402 server, finance-deploy, ENS module.
4. **Startup guard**: `assertNetworkConfigured(net)` throws if `NETWORK=mainnet` but any
   required address slot (agent bundle, resolver, etc.) is still a placeholder. Can't
   half-configure on stage.

## TDD discipline (applies to ALL weekend code)

**Iron law: no production code without a failing test first.** Red → verify red →
green → verify green → refactor. `bun test <file>` per cycle.

Current cycle state: `packages/shared/src/network.test.ts` exists and fails RED with
"Cannot find module './network'" — correct failure (feature missing). **Next step:**
implement `network.ts` minimally to green.

### What gets a test (per layer)
- **network.ts** — resolver: defaults, mainnet ids, USDC, facilitator, overrides, unknown-throws. (written)
- **walrus** — `WalrusStorage` satisfies `OgStorageClient`; store→read roundtrip; binary snapshot tar→Walrus→restore; AES encrypt/decrypt roundtrip. (Walrus is live so these are real integration tests, not mocks.)
- **x402 v2** — challenge shape matches v2 schema; client pays a stubbed 402 server; EIP-3009 authorization is well-formed; verification accepts a valid payment and rejects a tampered one.
- **revenue split** — given a payment of N, split = compute reserve + operator fee + net; sums to N; P&L numbers derive correctly.
- **ENS** — ENSIP-25 key construction (ERC-7930 encoding) matches spec example; verification fails on empty record, passes on non-empty; record resolution returns endpoints.
- **end-to-end** — see [07-build-order-checklist.md](07-build-order-checklist.md) §E2E.

### Note on existing untested code
Call sites we refactor currently have no tests. We add tests as we touch them
(characterization where behavior must be preserved); we do **not** rewrite working
contract logic — forge suite already covers contracts (`bun run test:contracts`).
