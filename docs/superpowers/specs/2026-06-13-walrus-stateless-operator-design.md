# Stateless Operator — Walrus storage + Seal encryption + ENS memory pointer

> **Design spec** · 2026-06-13 · ETHGlobal NYC continuity weekend
> Supersedes the encryption + pointer decisions in [`docs/nyc-2026/03-walrus.md`](../../nyc-2026/03-walrus.md)
> (which assumed local-disk pointers, a staged wipe demo, and ruled Seal NO-GO).

## Goal

Run the operator with **zero persistent disk**. Remove the Railway storage volume.
Every agent's brain (skills, memory, receipts) lives on **Walrus**, threshold-encrypted
with **Seal**, and is addressed by a **mutable ENS text record**. A cold-booting operator
rehydrates any agent from ENS + Walrus + Seal alone.

This is the stronger version of the Walrus bounty claim — not a staged "wipe-and-restore"
party trick, but a real architectural property: **the operator is stateless; the volume is
an optional cache, never a dependency.** It also fuses three bounty integrations into one
story: **ENS** is discoverability *and* memory addressing (ENSIP-25/26 + ERC-8004),
**Seal** is threshold-sealed memory, **Walrus** is the storage.

### North-star line

> **Public pointer in ENS → threshold-sealed brain in Seal → stored on Walrus.**

## Non-goals (YAGNI for this weekend)

- No cross-chain ownership policy (Base agent NFT → Sui `seal_approve`). Allowlist policy only.
- No eager-on-boot restore. Lazy restore via the existing `load()` hook.
- No per-mint Sui object beyond the one shared allowlist.
- No removal of the AES path — it stays as the offline/CI + fallback encryption.

## What lives on the volume today (the thing we're removing)

The Railway volume mounts at `./data`:

| On the volume | What it is | New durable home |
|---|---|---|
| `data/agents/<tokenId>/` | agent brain: self-learned `skills/`, `patterns/`, `memory.db` (SQLite FTS5), `system.md`, `bundle.lock.json`, `registry.json` | **Walrus snapshot** (tar → Seal → Walrus), blobId in the agent's ENS `agent-snapshot` record |
| `data/receipts.db` | global inference-tape index (`callId, tokenId, subscriber, ts, receipt, walrusBlobId`) | folded into each agent's snapshot as `receipts.ndjson`; `receipts.db` becomes a rebuildable cache |
| `data/agents/og-shadow/` | dead 0G shadow store | deleted |

## Architecture

### The mutable-pointer problem

Walrus is content-addressed — no mutable names. A stateless operator that just booted has
no way to know *which* Walrus blob is each agent's latest brain. ENS names **are** mutable
key→value records. So ENS becomes the pointer layer.

### Components

Reused as-is (already built + tested):
- `apps/operator/src/storage/walrus-storage.ts` — `WalrusStorage implements OgStorageClient` (raw HTTP, failover publishers).
- `apps/operator/src/storage/snapshot.ts` — `tar → encrypt → Walrus` / `Walrus → decrypt → untar`.
- `apps/operator/src/storage/crypto.ts` — AES-256-GCM envelope (now the fallback path).
- `apps/operator/src/store/ens-subname.ts` — `registerSubname` (`setSubnodeRecord` + `setText`).
- `apps/operator/src/store/ens-agent-resolver.ts` — ENS resolve + `verifyAgent`.

New:
- `apps/operator/src/storage/seal.ts` — `SealClient` wrapper: `sealEncrypt(data, id)` /
  `sealDecrypt(bytes)`; manages `SessionKey`, key-server config
  (`getAllowlistedKeyServers`), and the `seal_approve` PTB build.
- ENS pointer helpers: `setSnapshotPointer(ensName, blobId)` (one `setText`,
  key `agent-snapshot`) and `readSnapshotPointer(ensName)` (`getText`).
- A Sui **Move allowlist package** (adapted from Seal's example) defining `seal_approve`.
- An (unfunded) Sui keypair in operator env for the decrypt session key.

Surgically modified:
- `apps/operator/src/runtime/hermes.ts` — two spots only:
  1. **snapshot write path** (~L320): export receipts → tar → Seal → Walrus → schedule a
     **debounced, significant-change-gated** ENS pointer update (replaces the local
     `.snapshot` sibling file).
  2. **restore-on-missing** (~L165): resolve the blobId from **ENS** (not the local file)
     → Walrus → Seal decrypt → untar → re-ingest receipts.

### Encryption layer (Seal)

`snapshot.ts` swaps its key-wrap from AES to Seal when `SNAPSHOT_ENCRYPTION=seal`:

- **Encrypt:** `sealClient.encrypt({ threshold, packageId, id, data: tarball })`
  → `encryptedObject` bytes stored on Walrus. `id` encodes the agent (tokenId/vault).
  Seal returns a **backup symmetric key** — retained (operator env, derivable per-agent)
  as the disaster-recovery escape hatch.
- **Decrypt:** build the `seal_approve` PTB (transaction-kind only, **dry-run**) with the
  operator `SessionKey` → `sealClient.decrypt({ data, sessionKey, txBytes })` → tarball.
  **No gas, no on-chain execution** — key servers simulate the policy and return threshold
  shares; the SDK reconstructs the symmetric key client-side.
- **Policy:** Seal allowlist example; the operator's Sui address is on the allowlist.
  Threshold `t`-of-`n` over Mysten open-mode key servers (no single server can read).
- **Key servers:** Mysten-operated **open mode** via `getAllowlistedKeyServers(network)` —
  accept any package ID, no registration, no self-hosting.

Encrypt is pure client-side IBE (no Sui tx); decrypt is dry-run (no Sui gas). The only Sui
artifact that touches a transaction is the **one-time Move package publish**.

### ENS record schema

On each agent's subname (`<label>.slopstock.eth`), alongside existing ENSIP-26
(`agent-context`, `agent-endpoint[...]`, `addr`) + ENSIP-25
(`agent-registration[...]="1"`):

| Key | Value | Meaning |
|---|---|---|
| `agent-snapshot` | `<walrusBlobId>` | latest Seal-encrypted state tarball on Walrus |

Public pointer, sealed bytes. Every agent gets a subname (`registerSubname`, already wired)
— ENS is the discoverability layer, so subname registration is part of the mint path, not a
demo-only step.

## Data flows

### Snapshot write (after each state-changing task — async, non-blocking)

```
task completes → bundleHashAfter computed
  → export this agent's receipt rows (filter receipts.db WHERE tokenId=<id>)
      → data/agents/<id>/receipts.ndjson
  → tar(data/agents/<id>/)
  → Seal.encrypt(tarball, id=<id>)   [or AES if SNAPSHOT_ENCRYPTION=aes]
  → Walrus.storeBytes → blobId
  → IF bundleHashAfter ≠ lastPublishedHash (significant change):
        debounced → ENS setText(<sub>.slopstock.eth, 'agent-snapshot', blobId)   [mainnet tx]
        lastPublishedHash = bundleHashAfter
```

On `SIGTERM`/`SIGINT` (Railway redeploy): flush any pending pointer write before exit. A
clean redeploy never loses state; a hard crash loses at most the last task or two
(recovered next run).

### Cold-start restore (lazy, via existing `load()` hook)

```
load(tokenId), data/agents/<id>/ missing:
  → resolve <sub>.slopstock.eth → getText('agent-snapshot') → blobId
  → Walrus.readBytes(blobId)
  → Seal.decrypt (dry-run PTB)   [or AES if envelope is AES]
  → untar → data/agents/<id>/
  → re-ingest receipts.ndjson into receipts.db (INSERT OR REPLACE)
  → on no-pointer / decrypt-fail → fall back to manifest seed (named) or seed copy
```

Lazy (restore on first `load`) over eager-boot: matches the existing hook, no boot stampede.

### Receipts fold-in

`receipts.db` already carries `tokenId` + `walrusBlobId` + index `(tokenId, ts)` — **no
schema migration needed**. Per-agent rows export to `receipts.ndjson` inside the snapshot
and re-ingest on restore. The served `GET /receipts` tape reassembles per-agent from
ENS-pointed Walrus snapshots; individual receipts remain independently pinned to Walrus.

## Error handling / degradation

| Failure | Behavior |
|---|---|
| ENS pointer missing | fall back to manifest seed (named) or seed copy; log |
| Walrus read fails | failover publisher list (already in client); else seed fallback |
| Seal key servers down | decrypt with retained **backup symmetric key**; else AES fallback |
| Decrypt fails / tampered | log, fall back to seed; never crash the load path |
| ENS setText tx fails | snapshot already on Walrus; retry next significant change / on shutdown |
| Volume present | used as cache (faster cold start) — code never requires it |

## Configuration (Railway **env**, not volume)

```
STORAGE_BACKEND=walrus              # already default
SNAPSHOT_ENCRYPTION=seal            # seal | aes (aes for offline CI + fallback)
AGENT_SNAPSHOT_KEY=<base64url>      # AES fallback + Seal backup-key material
SUI_SEAL_KEYPAIR=<sui-priv>         # unfunded; session-key signing only
SEAL_PACKAGE_ID=<0x...>             # published allowlist policy package
SEAL_ALLOWLIST_ID=<0x...>           # allowlist object holding operator Sui address
SEAL_THRESHOLD=2                    # t-of-n; ≥2 so no single key server can read (n = open servers available)
WALRUS_EPOCHS=5                     # testnet epochs=90 broken on all 3 publishers
```

## Testing strategy (TDD)

**Unit, offline:**
- ENS pointer read/write (mocked RPC, mirrors existing ENS tests).
- `seal.ts` encrypt→decrypt roundtrip (testnet key servers) — guarded; AES roundtrip under
  `SNAPSHOT_ENCRYPTION=aes` for fully-offline CI.
- receipts export→ingest roundtrip (filter by tokenId, re-insert, assert rows equal).

**Integration, live:**
- snapshot → ENS `setText` → **true `rm -rf data/agents/`** → cold `load()` resolves ENS
  → Seal+Walrus restore → assert `skills/`, `memory.db`, receipts **byte-identical**.
  Real Walrus testnet + ENS Sepolia for the test; mainnet for the live demo.
- **Amnesia demo script** (`apps/operator/scripts/amnesia-demo.ts`): full wipe restored
  *purely* from ENS + Walrus + Seal, zero local pointer. 30s, visually dramatic.

## Rollout — remove the volume safely

1. Build + green all tests with the volume **still attached** (prove restore works while safe).
2. Move durable config into Railway **env** (above) — nothing stateful left on the volume.
3. Publish the Seal allowlist Move package; create allowlist object; add operator Sui address.
4. Detach the Railway volume → cold boot → verify demo agents rehydrate from ENS+Walrus+Seal.
5. Delete the dead `og-shadow` path.

**Stop-losses:** code never *requires* the volume — re-attaching it (instant) is the venue
fallback if restore flakes; the retained backup symmetric key covers key-server downtime;
the `seal|aes` flag covers Seal-SDK instability (it's beta).

## Acceptance criteria

- [ ] Operator boots with **no volume** and rehydrates `auditor` + `oracles` brains
      (skills + memory + receipts) from ENS + Walrus + Seal.
- [ ] Agent state on Walrus is **Seal threshold-encrypted** (show ciphertext on the
      aggregator vs decrypted in-app); backup-key fallback proven.
- [ ] `agent-snapshot` ENS text record resolves to the live blobId; updated on significant
      change + graceful shutdown.
- [ ] Amnesia demo: full `rm -rf data/agents/` → restart → agents return with every
      self-taught skill + memory, verified against the receipt hash chain.
- [ ] Receipts tape (`GET /receipts`) reassembles per-agent from snapshots after cold start.
- [ ] One Sui Move allowlist package published; Mysten open key servers used (no self-host).

## References

- Seal: <https://seal.mystenlabs.com/> · docs <https://seal-docs.wal.app/UsingSeal> ·
  `getAllowlistedKeyServers` <https://sdk.mystenlabs.com/typedoc/functions/_mysten_seal.getAllowlistedKeyServers.html> ·
  mainnet launch <https://www.mystenlabs.com/blog/seal-mainnet-launch-privacy-access-control>
- Walrus: <https://docs.wal.app/>
- Existing plan: [`docs/nyc-2026/03-walrus.md`](../../nyc-2026/03-walrus.md) ·
  master index [`docs/nyc-2026/MASTERPLAN.md`](../../nyc-2026/MASTERPLAN.md)
