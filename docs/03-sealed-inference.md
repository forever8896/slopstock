# 03 — Sealed Inference Pipeline

## 1. Goal

Run an agent's inference such that:
- The **subscriber** gets the output and a TEE attestation proving the right model ran.
- The **operator** never sees the subscriber's input or output.
- The **acquirer** of the iNFT, post-`iTransfer`, can run inference; the previous owner cannot (their key is rotated out).
- Subscribers without an active `authorizeUsage` grant are rejected.

This is the cryptographic heart of the project. Every other component (revenue, identity, discovery) ultimately depends on **someone trusting that "the agent really ran."**

## 2. Building blocks (0G primitives)

| Primitive | What it gives us |
|---|---|
| 0G Storage (KV + Log) | Encrypted blob storage for weights, system prompt, RAG corpus, plus an append-only Log for inference receipts |
| 0G Compute Sealed Executor | TEE-backed inference runtime; OpenAI-compatible `/v1/proxy` endpoint; emits TEE quote per call |
| ERC-7857 `sealedKey` | Per-tokenId key blob that the TEE can unwrap (keyed to operator's pubkey) |
| ERC-7857 `iTransfer` proof | A re-encryption proof produced by the TEE during ownership transfer |
| ERC-7857 `authorizeUsage` | On-chain ACL: only listed addresses can invoke the agent |

## 3. Cryptographic objects

```
master content key              k_content    (random, 256-bit, generated once at mint)
agent weight blob               W            (LoRA + system prompt + RAG corpus)
encrypted weights               C_W         = AES-GCM(k_content, W)
encrypted system prompt         C_SP        = AES-GCM(k_content, system_prompt)
encrypted RAG corpus            C_RAG       = AES-GCM(k_content, rag_corpus)
operator public key             pk_operator  (or first-acquirer's pk; whoever currently owns)
sealed key (on-chain field)     sealedKey   = TEE-attested-encrypt(k_content, pk_operator)
metadata hash (on-chain)        h_meta      = keccak256(C_W ‖ C_SP ‖ C_RAG ‖ params)
```

The TEE has a hardware-rooted public key `pk_TEE`. Anyone can encrypt to the TEE; only enclaves with the matching attestation can decrypt.

## 4. Mint flow (operator-side)

**Pre-condition:** operator has trained a LoRA + chosen a system prompt + curated a RAG corpus.

```
operator CLI                    0G Storage              0G Compute (TEE)        0G Chain
    │                                │                        │                      │
1.  │ generate k_content (random)    │                        │                      │
    │                                │                        │                      │
2.  │ encrypt(W, k_content) → C_W    │                        │                      │
    │ encrypt(SP, k_content) → C_SP  │                        │                      │
    │ encrypt(corpus, k_content) → C_RAG                      │                      │
    │                                │                        │                      │
3.  │ upload C_W, C_SP, C_RAG ──────▶│                        │                      │
    │                          ◀──── storage URIs             │                      │
    │                                │                        │                      │
4.  │ request_seal({k_content, pk_operator}) ─────────────────▶│                     │
    │                                │                        │                      │
    │      TEE generates `sealedKey` = wrap(k_content, pk_operator) inside enclave    │
    │      TEE produces attestation quote A_seal                                      │
    │                                │                        │                      │
    │ ◀───────────────── sealedKey, A_seal ──────────────────│                      │
    │                                │                        │                      │
5.  │ compute h_meta = keccak256(...)│                        │                      │
    │                                │                        │                      │
6.  │ mint(metadataURI, h_meta, sealedKey, A_seal) ───────────────────────────────▶│
    │                                                                            tokenId
    │ ◀────────────────────────────────────────────────────────────────────────────│
```

**Notes:**
- The CLI never sees `pk_TEE` — that's bound at request time by 0G Compute.
- The operator's `pk_operator` is their wallet pubkey or a derived inference key; recommended to use a separate inference key so wallet compromise ≠ inference compromise.
- `A_seal` is verified on-chain by the iNFT's attestation verifier (this is what makes the mint trustworthy).

## 5. Inference flow (per call)

**Pre-condition:** subscriber has paid the x402 paywall and has been granted `authorizeUsage(tokenId, subscriber, expires)`.

```
subscriber          operator node           AXL mesh           0G Compute (TEE)        0G Storage
    │                    │                       │                       │                    │
1.  │ POST /infer        │                       │                       │                    │
    │ {input}            │                       │                       │                    │
    │───────────────────▶│ verify authz on-chain                         │                    │
    │                    │ verify x402 payment                           │                    │
    │                    │                       │                       │                    │
2.  │                    │ open inference session(tokenId, subscriber) ─▶│                    │
    │                    │                       │                       │                    │
    │                    │                  TEE pulls C_W, C_SP, C_RAG ◀──────────────────────│
    │                    │                  TEE unwraps k_content from sealedKey              │
    │                    │                  TEE decrypts inputs to W, SP, corpus              │
    │                    │                       │                       │                    │
3.  │                    │ stream input ─────────────────────────────────▶│                    │
    │                    │                       │                       │                    │
    │                    │                       │   TEE runs inference  │                    │
    │                    │                       │   (qwen2.5-coder-32b  │                    │
    │                    │                       │    + LoRA + RAG)      │                    │
    │                    │                       │                       │                    │
4.  │                    │                       │   TEE signs output    │                    │
    │                    │                       │   produces TEEML quote A_call               │
    │                    │ ◀──── output, A_call ─────────────────────────│                    │
    │                    │                       │                       │                    │
5.  │                    │ append InferenceReceipt to 0G Log ────────────────────────────────▶│
    │                    │                       │                       │                    │
6.  │ ◀──── output, A_call ─── (over AXL mesh) ──│                       │                    │
    │                                                                                          │
7.  │ subscriber locally verifies A_call against on-chain pubkey                              │
```

**The subscriber verifies the attestation:**
- Reads the iNFT's `expectedTeeMeasurement` from the contract (set at mint, verifiable)
- Verifies the TEE quote against Intel/NVIDIA root certificates (off-chain RPC to attestation service)
- If it doesn't verify: reject the output, optionally dispute the receipt on-chain

## 6. The `iTransfer` (re-encryption) flow

This is the magic trick. When `Marketplace.accept()` calls `iTransfer(tokenId, acquirer, proof)`:

```
operator                Marketplace          0G Compute (TEE)         AgentNFT
   │                        │                       │                       │
   │ accept(tokenId, proof) │                       │                       │
   │                        │ requestReencrypt(tokenId, acquirerPubkey) ───▶│
   │                        │                       │                       │
   │                        │   TEE: in-enclave operations                  │
   │                        │      - load sealedKey_old, A_seal_old         │
   │                        │      - unwrap k_content using pk_TEE          │
   │                        │      - generate k_content_new (random)        │
   │                        │      - re-encrypt C_W, C_SP, C_RAG with k_new │
   │                        │      - emit new sealedKey_new = wrap(k_new, pk_acquirer)
   │                        │      - emit new metadataHash_new              │
   │                        │      - emit attestation A_transfer            │
   │                        │ ◀───── proof = (sealedKey_new, h_meta_new, A_transfer)
   │                        │                       │                       │
   │                        │ iTransfer(tokenId, acquirer, proof) ─────────▶│
   │                        │                                          contract verifies A_transfer
   │                        │                                          updates ownership
   │                        │                                          updates sealedKey
   │                        │                                          updates metadataHash
   │                        │                                          clears authorizeUsage[]
   │                        │                                          emits Transfer event
```

**Crucial property:** during the in-enclave step, the TEE **must rotate `k_content`** so that the previous owner's `sealedKey_old` is useless even if they kept it. This is what gives us "atomic handover with no leaks." The reference impl from `0g-agent-nft` includes this rotation; we verify it in tests with a mock TEE.

## 7. ZKP fallback (if TEE flow is unavailable)

ERC-7857 supports a ZKP variant of the proof. In this flow:
- Re-encryption is performed off-chain by the seller
- A SNARK proves the new ciphertext correctly re-encrypts the old plaintext to the new key
- The proof leaks nothing about the plaintext, but **the new key is revealed to the prover** (the seller)

For our hackathon: **TEE flow is preferred.** ZKP flow is the fallback if 0G Compute's TEE attestation isn't deployed/exposed. The ZKP flow has a UX wart (we'd need to force a re-mint to rotate keys after every sale) but is provably equivalent in security if we add a mandatory rotation step.

**Decision rule for Hour 0:** if 0G Compute's `iTransfer`-supporting TEE service is callable from a hackathon SDK, use TEE. Else use ZKP. Else mock and label clearly in the demo.

## 8. Hero agent inference pipeline

For our example agent (auditor — Solidity audit), the inference pipeline is:

1. Subscriber posts Solidity source.
2. Operator node verifies x402 payment (1 USDC) and `authorizeUsage`.
3. Operator opens a session with 0G Compute, model `qwen2.5-coder-32b`, LoRA = our audit-LoRA (encrypted on Storage).
4. Inside the TEE:
   - Decrypt LoRA + system prompt + RAG corpus (audit-report training set)
   - Slither-style static analysis runs first (deterministic preprocess)
   - Coder model summarizes findings, ranks by severity, suggests patches
   - Output is a JSON: `{ findings: [{severity, title, location, description, fix}], summary }`
5. TEE signs output + emits TEEML quote.
6. Operator appends receipt to 0G Log.
7. Returns output + attestation to subscriber via AXL.

**Latency target:** 5–15s per call (acceptable for an audit; bad for a chatbot — we don't pretend this is real-time).

## 9. Operator node — concrete components

The operator node is a small Node.js (or Python) service running:

- **AXL peer** (`axl --bootstrap=tls://bootstrap.gensyn.ai:9000`)
- **MCP server** exposing `agent.infer({tokenId, input}) → {output, attestation}` — bound to `localhost:NNNN/mcp/`
- **x402 gateway** at `localhost:8402` that:
  - Issues `402 Payment Required` with `price=1 USDC, asset=USDC.base, recipient=VAULT_BASE`
  - Validates payment receipts (via the x402 facilitator)
  - Calls `AgentNFT.authorizeUsage(tokenId, subscriber, +1h)` after payment
- **0G Compute client** that sends inference jobs and parses the attestation
- **0G Log writer** that appends receipts

```
node operator/index.ts
  ├── axl-bridge       (talks to localhost:9001)
  ├── mcp-server       (serves /infer)
  ├── x402-gateway     (validates payments)
  ├── ogc-client       (0G Compute)
  ├── ogs-client       (0G Storage)
  └── chain-client     (viem; reads/writes AgentNFT, RevenueVault)
```

**~600 LoC.** Buildable in 8-10h by 1 backend dev.

## 10. Verifier client (subscriber-side)

The subscriber's frontend or CLI verifies:

```ts
async function verifyReceipt(receipt: InferenceReceipt, tokenId: bigint) {
  // 1. fetch on-chain expected measurement
  const expected = await agentNft.read.expectedMeasurement([tokenId]);

  // 2. parse the TEEML quote
  const quote = parseTeeQuote(receipt.teeAttestation.quote);

  // 3. verify quote against Intel root cert
  const intelOK = await verifyIntelTdxQuote(quote);
  if (!intelOK) throw new Error("Intel TDX signature invalid");

  // 4. compare measurement
  if (quote.measurement !== expected) throw new Error("Wrong model ran");

  // 5. verify output signature against on-chain pubkey
  const sigOK = verifyEcdsa(receipt.outputHash, receipt.signature, quote.signingPubKey);
  if (!sigOK) throw new Error("Output signature mismatch");

  return true;
}
```

The frontend calls this transparently. If verification fails, the UI shows a red banner: "⚠️ This output is unattested — do not trust."

## 11. Threats + mitigations

| Threat | Mitigation |
|---|---|
| Operator runs a different (cheaper) model and lies | TEE measurement verified by subscriber against on-chain pinned measurement |
| Operator caches a previous output and replays | Each receipt includes the input hash + nonce; subscriber input has a salt |
| Operator denies service after payment | Subscriber files dispute on-chain; operator stake (or share holdings) at risk; v1 stretch goal |
| Subscriber leaks their authorized session | Sessions are bound to the subscriber address + signed nonce; one-time use unless they mint a fresh session |
| Compromised TEE | Out of scope — same trust assumption as 0G Compute itself; we'd rotate to ZKP path if a CVE drops |
| Operator + acquirer collude to keep prior owner's key | TEE rotation in `iTransfer` is non-bypassable in TDX flow; ZKP flow requires manual post-transfer mint of fresh ciphertext |

## 12. What "demo-ready" means

For the demo, we must show:
- [ ] A real `mint()` call where `sealedKey` is a real attested object (not bytes32 zero)
- [ ] A real inference call that returns a real attestation, verified live in the frontend
- [ ] A real `iTransfer()` with re-encryption — even if we have to use a mocked TEE service, label it clearly as "demo TEE oracle: stratum-test-tee.0g.ai"

If we can't get any of these to work end-to-end, we **degrade honestly** — disable the sealed/attested path and ship a "demo path" with a banner: "Sealed Executor unavailable on 0G Compute Galileo testnet at hackathon time; this demo simulates the cryptographic flow." Better than faking it without disclosure.
