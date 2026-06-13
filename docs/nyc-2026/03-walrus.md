# 03 — Walrus (decentralized storage for agents)

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
