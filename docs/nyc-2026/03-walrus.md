# 03 — Walrus (decentralized storage for agents)

## ✅ UPDATE (2026-06-14): Seal + ENS-pointer + stateless operator — IMPLEMENTED

Everything below this section reflects the original weekend plan. The following supersedes the stale notes on Seal (NO-GO) and local pointers.

**What shipped on `feat/stateless-operator-walrus-seal-ens` (branch, unmerged as of 2026-06-14):**

- **Seal is IN.** `@mysten/seal` threshold IBE is integrated as `SealCipher` — gasless encrypt/decrypt via Mysten open-mode testnet key servers. The old "Seal NO-GO" note is superseded; the mainnet-live SDK works, open-mode public key servers exist **on testnet** (mainnet has no Mysten open-mode servers yet → Seal path targets testnet for the hackathon). `SNAPSHOT_ENCRYPTION=seal` activates it; `SNAPSHOT_ENCRYPTION=aes` (default) is the offline/CI fallback path. One Sui Move `agent_seal::allowlist` policy package is authored (compile-pending: needs `sui move build` + `sui client publish`).
- **Pointer is an ENS `agent-snapshot` text record (not a local file).** `setSnapshotPointer`/`readSnapshotPointer` write/read the mutable record on Ethereum mainnet. The operator keeps no volume-local state pointer → **the operator is stateless** (Railway volume is now an optional cache, not a hard dependency).
- **Receipts folded into snapshots.** `exportAgentReceipts`/`importAgentReceipts` — `receipts.db` becomes a rebuildable cold-start cache rather than the source of truth.
- **AES path unchanged as fallback.** `AesCipher` (AES-256-GCM, `AGENT_SNAPSHOT_KEY` env) is the default and the offline-CI path; `SealCipher` is opt-in.
- **Amnesia demo PROVEN — Mode A (live Walrus testnet, AES):** full `data/agents/` wipe → byte-identical restore confirmed against live Walrus testnet. Script: `apps/operator/scripts/amnesia-demo.ts`.
- **Design refs:** [spec](../superpowers/specs/2026-06-13-walrus-stateless-operator-design.md) · [plan](../superpowers/plans/2026-06-13-walrus-stateless-operator.md).

**Remaining (user infra — NOT automated):**
1. `sui move build` inside `packages/agent-seal/` and `sui client publish` → capture `SEAL_PACKAGE_ID`.
2. Run `apps/operator/scripts/seal-publish-policy.ts` → capture `SEAL_ALLOWLIST_ID`.
3. Set `SEAL_*` + `SUI_SEAL_KEYPAIR` + `ENS_SNAPSHOT_ENABLED=1` + `L1_RPC` in operator env.
4. Run live Seal round-trip: `SEAL_LIVE_TEST=1 bun test`.
5. Run amnesia Mode B (ENS pointer + Seal cipher → full cold-boot from ENS+Walrus).
6. Detach the Railway volume (infra action — makes statelessness official).

---

> **Bounty:** Sui/Walrus "Best product integrating Walrus" — Continuity ($3k, up to 4
> winners). Booth said **product-market-fit** is what they're judging. We fit their
> "already on decentralized storage, real product adopting Walrus" profile exactly.

## Why it's non-cosmetic

An exchange is only as credible as its tape. Today the "0G Storage" integration is a
**shadow** — `apps/operator/src/storage/og-storage-impl.ts` writes keccak-addressed files
to local disk and honestly returns `realPin:false`. Nothing is actually decentralized.
Walrus makes three things real: the **listing** (manifests), the **tape** (receipts), and
the **lineage** (agent memory). The payoff is agent **portability**: any operator can
rehydrate any agent from chain + Walrus alone — the missing half of "agents as
transferable property."

0G stays load-bearing as **chain + sealed compute**; Walrus takes **storage**. Clean split,
no rip-out.

## Three layers

1. **Manifests** — small JSON (identity, system prompt, tools, inline skills/patterns,
   pricing). Currently pinned via `OgStorageClient` shadow. Drop-in: `WalrusStorage`
   implements the same interface. On-chain `metadataHash` = keccak(canonical manifest)
   is storage-agnostic → no contract change; record the Walrus blobId alongside.
2. **Receipts** — receipt v2 (transcript, bundleHashBefore/After, stateDeltaHash, TEE
   attestation) currently in SQLite (`./data/receipts.db`, served `GET /receipts`). Pin
   each receipt to Walrus; web "inference tape" reads from Walrus (public aggregator).
3. **Agent memory snapshots** — Hermes state (`data/agents/<tokenId>/`: self-created
   `skills/`, `memory.db` SQLite+FTS5, `bundle.lock.json`). After each state-changing task:
   tar → **AES-256-GCM encrypt** → Walrus; record blobId next to `bundleHashAfter` (the
   receipt chain *is* the lineage). On `load(tokenId)` with missing state: fetch latest
   snapshot from Walrus, decrypt, unpack.

## Tech decisions (from research)

- **Raw HTTP, not @mysten/walrus SDK.** We're Bun/EVM, no Sui wallet. Public testnet
  publishers pay Sui-side cost; aggregators serve reads. (SDK only needed to *be* a
  mainnet publisher.) Client built + proven: `apps/operator/src/storage/walrus-client.ts`.
- **Testnet** (free, public publishers w/ failover list). No public **mainnet** publisher
  exists → testnet is the bounty target; that's fine and judges accept it.
- **Encryption: AES-256-GCM client-side, NOT Seal.** Seal requires deploying a Move package
  on Sui (no EVM policy story) — NO-GO for the weekend. AES is ~20 lines of WebCrypto (built
  into Bun), in Seal's own envelope shape so we can migrate the key-wrap to Seal later
  without re-architecting. Key held by operator (env/derived per-agent), transferred on
  acquisition. Story preserved: **public tape, sealed memory.**
- Walrus is content-addressed → identical bytes return same blobId (free dedup for receipts).
- Endpoints: publisher `PUT $PUB/v1/blobs?epochs=N`, aggregator `GET $AGG/v1/blobs/<id>`.
  10 MiB blob limit (our snapshots are 100–500 KB). testnet epoch ≈ 1 day; use `epochs=90`.

## Build steps (TDD)

1. **`WalrusStorage implements OgStorageClient`** — test: store→read JSON roundtrip via the
   interface; binary roundtrip. (Walrus is live → real integration tests, no mocks.) Wire as
   the storage impl behind a `STORAGE_BACKEND=walrus|shadow` switch (default walrus).
2. **AES envelope** — test: encrypt(x) → decrypt → x; ciphertext ≠ plaintext; wrong key fails.
   `apps/operator/src/storage/crypto.ts`.
3. **Snapshot/restore** — test: tar a fixture state dir → encrypt → Walrus → wipe → restore →
   files+memory.db byte-identical. Hook snapshot after Hermes `runTask` state write; hook
   restore in `load(tokenId)` when local dir missing.
4. **Receipt pinning** — pin receipt to Walrus on record; store blobId in receipt index;
   web tape reads from aggregator.

## Acceptance criteria / THE DEMO

- [ ] Manifests + receipts + memory snapshots all on Walrus (real blobIds, live on aggregator).
- [ ] Web app reads the inference tape from a public Walrus aggregator (not the operator disk).
- [ ] **Amnesia demo:** wipe operator `data/agents/` on stage → restart → AUDIT comes back
      with every self-taught skill + memory, restored from Walrus, verified against the
      receipt hash chain. 30 seconds, visually dramatic.
- [ ] Memory blobs are encrypted (show ciphertext on the aggregator vs decrypted in-app).

## Stop-losses
- Public testnet publisher flaky → failover list already in client; keep 3 publishers.
- Snapshot/restore too fiddly by Sat night → ship manifests + receipts on Walrus (still
  qualifies strongly); memory lineage becomes the "and we extended it to live agent state"
  bonus beat.

## Resources
- https://docs.wal.app/ · EVM patterns https://mystenlabs.github.io/evm-sui/
- Seal (for the record / future): https://github.com/MystenLabs/seal
