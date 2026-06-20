# 13 · Go-Live Runbook — flipping the staged features to mainnet

Status: **all code is in and tested.** What remains to make the full system live is an
**ops sequence** — fund wallets, flip env flags, publish one Move package — not a code
change. This doc is the precise, ordered checklist for each of the three staged capabilities:

1. **Self-funding compute loop** (USDC → ETH → OG → 0G ledger)
2. **ENS mainnet snapshot pointer** (self-improvement → latest Walrus blobID)
3. **Seal on Sui mainnet** (threshold-encrypted brain) — see [12-seal-mainnet-runbook.md](12-seal-mainnet-runbook.md)

> Everything below is **off by default and safe**. Each feature is gated behind an explicit
> flag *and* a required secret/funded wallet, so nothing moves real money until you deliberately
> arm it. Wallet funding is the one thing only you can do — see
> [00-state-and-funding.md](00-state-and-funding.md) for the funding addresses.

---

## Pre-flight (once)

```bash
bun install
bun run --filter @stratum/operator typecheck   # expect: 0 errors
bun --filter @stratum/operator test src/funding/   # expect: all green
```

The operator reads config once at boot (`apps/operator/src/config.ts`); every flip below is an
`.env` edit followed by a restart. Live-money legs additionally require a **non-dry-run** flag.

---

## 1 · Self-funding compute loop

**What it does.** On a timer, if the 0G compute ledger drops below a threshold, convert a slice of
accrued USDC revenue to OG and refill the ledger: `USDC →(Uniswap V3)→ ETH →(LI.FI)→ OG →(broker)→ ledger`.

**Code.** `apps/operator/src/funding/{scheduler,topup,policy,executor,split-config,spend-log}.ts`.
The swap is now priced via Uniswap V3 QuoterV2 and guarded by a real `amountOutMinimum`
(`executor.ts:applySlippage` + `quoteEthOut`); the chain config is self-consistent and selected by
`SELF_FUND_NETWORK` (`executor.ts:resolveChainConfig`), decoupled from the app-wide `BASE_RPC_URL`.

### Safety gates (all must be satisfied to move funds)

| Gate | Env | Default | Live value |
|---|---|---|---|
| Scheduler on | `SELF_FUND_ENABLED` | `1` (on) | `1` |
| **Dry-run** | `SELF_FUND_DRY_RUN` | `1` (decide + log only) | **`0`** to spend |
| Operator key present | `OPERATOR_PRIVATE_KEY` | — (required) | funded mainnet key |
| Network | `SELF_FUND_NETWORK` | `mainnet` | `mainnet` |

Hard caps (enforced by the pure, tested `decideTopup` policy — they clamp every spend):

```
SELF_FUND_THRESHOLD_OG=3        # top up when ledger < 3 OG
SELF_FUND_TOPUP_USDC=5          # desired top-up size
SELF_FUND_FLOOR_USDC=0          # never spend the reserve below this
SELF_FUND_PERTOPUP_CAP_USDC=20  # max single top-up
SELF_FUND_DAILY_CAP_USDC=50     # max auto-spend per rolling 24h
SELF_FUND_SLIPPAGE_BPS=100      # 1% — sets the swap+bridge min-out
SELF_FUND_INTERVAL_HOURS=168    # weekly cadence
SELF_FUND_FIRST_DELAY_S=120     # first tick after boot
```

### Feeding the reserve (optional payment split)

To route a slice of each inbound x402 payment into the reserve the loop spends from:

```
COMPUTE_SLICE_BPS=1000              # e.g. 10% of each payment
COMPUTE_RESERVE_ADDRESS=0x<operator reserve addr>
```

Without this, the loop simply spends from whatever USDC the operator wallet already holds on Base.

### Go-live sequence

1. **Fund** the operator wallet on Base mainnet with the USDC you want available, plus a little
   ETH for gas on the approve/swap txs.
2. **Rehearse in dry-run** (default). Restart the operator and watch the logs:
   ```
   [self-fund] scheduler armed — net=mainnet (base 8453→0G 16661), every 168h, dryRun=true …
   [self-fund] tick 🟡 dry-run $5.00 — dry-run: would top up ($5.00)
   ```
   Confirm the numbers and the network line are what you expect. (Shorten `SELF_FUND_FIRST_DELAY_S`
   to test the first tick quickly.)
3. **Arm it:** set `SELF_FUND_DRY_RUN=0`, keep caps small for the first live run, restart.
   A successful tick logs `✅ TOPPED UP $X — swapped … → … ETH → +… OG to ledger`.
4. The spend log persists to `<AGENTS_DATA_DIR>/self-fund-spend.json` (override with
   `SELF_FUND_SPEND_LOG`) and enforces the rolling daily cap across restarts.

**Rollback:** set `SELF_FUND_DRY_RUN=1` (or `SELF_FUND_ENABLED=0`) and restart. No on-chain state to unwind.

**Testnet rehearsal of the mechanics:** `SELF_FUND_NETWORK=testnet` selects Base Sepolia / 0G
Galileo presets. Note a liquid USDC/WETH pool may not exist there; every address is overridable
via `SELF_FUND_{USDC,WETH,SWAP_ROUTER,QUOTER,POOL_FEE,BASE_RPC_URL,OG_RPC_URL,*_CHAIN_ID}` if a
contract has moved. See `.env.example` for the full list.

---

## 2 · ENS mainnet snapshot pointer (self-improvement → blobID)

**What it does.** After a Hermes turn changes the agent's bundle (a new/updated skill, memory),
the operator snapshots the brain to Walrus (encrypted), gets a blobID, and writes it to the
agent's ENS `agent-snapshot` text record on Ethereum L1. Wipe the disk → cold-boot from the
pointer. Loop: `runTask → re-hash bundle → snapshot → Walrus blobID → setSnapshotPointer (ENS)`.

**Code.** `apps/operator/src/runtime/hermes.ts` (`maybePublishPointer`),
`store/snapshot-pointer.ts`, `storage/snapshot.ts`. Sepolia-tested; mainnet path is wired and
gated.

### Safety gates

| Gate | Env | Default | Live value |
|---|---|---|---|
| Feature flag | `ENS_SNAPSHOT_ENABLED` | off (`""`/`false`) | **`1`** |
| L1 RPC | `L1_RPC` | `""` | Ethereum mainnet RPC URL |
| Deployer key | `DEPLOYER_PRIVATE_KEY` | optional | key that owns/manages the ENS name, funded with L1 ETH |

The agent must also resolve to a known ENS name (via the dynamic registry or the seed map). The
publish debounces on bundle-hash change, so it only writes when the brain actually changed.

### Go-live sequence

1. **Fund** the deployer wallet with L1 ETH (ENS text-record writes are real L1 txs — gas only).
2. Set `L1_RPC`, `DEPLOYER_PRIVATE_KEY`, `ENS_SNAPSHOT_ENABLED=1`. Restart.
3. Drive one non-trivial task so the agent writes/updates a skill. On the next turn the operator
   logs the snapshot blobID and the ENS write. Verify with the ENS app or by reading the
   `agent-snapshot` text record.
4. **Validate cold-boot:** wipe `<AGENTS_DATA_DIR>/<tokenId>` and restart — it should restore
   byte-identical from the pointer (see `storage/snapshot.test.ts` for the proven roundtrip).

**Rollback:** `ENS_SNAPSHOT_ENABLED=0` and restart. Existing pointer stays valid.

---

## 3 · Seal on Sui mainnet (threshold-encrypted brain)

Full sequence lives in **[12-seal-mainnet-runbook.md](12-seal-mainnet-runbook.md)**. Summary:

1. Generate + fund the operator Sui key (~0.5 SUI covers publish + allowlist; encrypt/decrypt are gasless):
   `bun run apps/operator/scripts/seal-keygen.ts`.
2. Publish the Move package and create the allowlist:
   `cd move/agent_seal && sui move build && sui client publish` → record the package + allowlist IDs.
3. Set in `.env`: `SNAPSHOT_ENCRYPTION=seal`, `SEAL_NETWORK=mainnet`,
   `SEAL_PACKAGE_ID=…`, `SEAL_ALLOWLIST_ID=…`, `SEAL_KEY_SERVERS=0x…,0x…`
   (≥ `SEAL_THRESHOLD`, default 2; pick from the verified-key-server list), `SUI_SEAL_KEYPAIR=…`.
4. Restart; the next snapshot is Seal-encrypted. AES remains the fallback when `SNAPSHOT_ENCRYPTION=aes`.

**Rollback:** `SNAPSHOT_ENCRYPTION=aes` and restart.

---

## Master checklist

- [ ] `bun run --filter @stratum/operator typecheck` → 0 errors
- [ ] Operator wallet funded on Base mainnet (USDC + gas ETH)
- [ ] Self-funding rehearsed in dry-run; log line + caps confirmed
- [ ] `SELF_FUND_DRY_RUN=0`, small caps, first live top-up verified
- [ ] Deployer wallet funded with L1 ETH
- [ ] `ENS_SNAPSHOT_ENABLED=1` + `L1_RPC` + `DEPLOYER_PRIVATE_KEY`; pointer write verified
- [ ] Cold-boot from pointer validated (wipe → byte-identical restore)
- [ ] (Optional) Seal package published; `SNAPSHOT_ENCRYPTION=seal` + mainnet key servers set
- [ ] Funded Sui key for Seal (~0.5 SUI)
