# 14 · Self-host a Seal key server on Sui mainnet (free path)

Status: **everything in this repo is ready.** Seal mainnet has **no free open-mode
key servers** (every listed provider — Enoki, Ruby, NodeInfra, … — is a paid plan).
Seal is open-source, so the free way to get genuine **Seal on mainnet** is to run your
own Open-mode key server. This is the step-by-step.

Trust note: a single self-hosted server (threshold 1) is centralized — *you* hold the
master key — but it is cryptographically real Seal on mainnet. For stronger trust later,
run a second server (threshold 2) or switch to a paid committee provider; both are pure
`SEAL_KEY_SERVERS` / `SEAL_THRESHOLD` changes (no code).

What's already done (don't redo): the `agent_seal` **policy** package + allowlist are
published on mainnet and the operator Sui address is in the allowlist
(see [seal-mainnet-deploy.txt](../../seal-mainnet-deploy.txt)); the operator code accepts a
custom key server via `SEAL_KEY_SERVERS` (+ optional auth) since PR #3.

Two distinct package IDs — don't conflict them:
- **Seal SYSTEM package** (Mysten), mainnet `0x931739…6c4e45` — used only to *register* the key server.
- **agent_seal POLICY package** (ours), mainnet `0x138eb231…85f27c43` — stays `SEAL_PACKAGE_ID`; it's the `seal_approve` allowlist policy.

---

## Prereqs
- The funded Sui keypair (`SUI_SEAL_KEYPAIR` in `.env`, addr `0x66c4…52e4`, ~5.76 SUI) — covers the one registration tx.
- A host that serves a public **HTTPS** endpoint (Railway works — you already deploy there).
- Rust toolchain **or** Docker to build the seal binaries.

## Step 1 — Build the seal tools
```bash
git clone https://github.com/MystenLabs/seal && cd seal
# seal-cli for key generation; key-server is the daemon
cargo build --release --bin seal-cli --bin key-server   # or use the Dockerfile (Step 4)
```

## Step 2 — Generate the BLS master key (Open mode)
```bash
./target/release/seal-cli genkey
# Master key: <MASTER_KEY>     ← SECRET. This becomes the server's MASTER_KEY env. Never commit.
# Public key: <MASTER_PUBKEY>  ← public; you register this on-chain next.
```

## Step 3 — Register the key server on-chain (no Sui CLI needed)
Decide the public URL first (it's baked into the on-chain object and verified by clients).
From the operator repo root, with `.env` present:
```bash
KS_URL=https://seal.<your-app>.up.railway.app \
KS_PUBKEY=0x<MASTER_PUBKEY> \
KS_NAME=slopstock-agent-seal \
bun run seal-keyserver/register-key-server.ts
# → prints:  ✅ KeyServer object id: 0x<KEY_SERVER_OBJECT_ID>
```
(Equivalent official path: `sui client call --function create_and_transfer_v2_independent_server
--module key_server --package 0x931739…6c4e45 --args <NAME> <URL> 0 <MASTER_PUBKEY>`.)

## Step 4 — Run the server (Docker / Railway)
Put `<KEY_SERVER_OBJECT_ID>` into [`seal-keyserver/key-server-config.mainnet.yaml`](../../seal-keyserver/key-server-config.mainnet.yaml), then:
```bash
# from the cloned seal repo:
docker build -t seal-key-server . --build-arg GIT_REVISION="$(git describe --always --abbrev=12 --dirty --exclude '*')"
docker run -p 2024:2024 \
  -v $(pwd)/key-server-config.mainnet.yaml:/config/key-server-config.yaml \
  -e CONFIG_PATH=/config/key-server-config.yaml \
  -e MASTER_KEY=<MASTER_KEY> \
  seal-key-server
```
On Railway: deploy this image as a service, mount the yaml, set `MASTER_KEY` (secret) +
`CONFIG_PATH`, expose port 2024 over HTTPS, and point your domain at it so the live URL
matches `KS_URL` from Step 3. The server's port is 2024; the public URL must be HTTPS.

## Step 5 — Wire the operator and verify
In the operator `.env`:
```
SNAPSHOT_ENCRYPTION=seal
SEAL_NETWORK=mainnet
SEAL_PACKAGE_ID=0x138eb231ac54b5259972aadba6525de770e2b796d6e7baed9afb354e85f27c43   # agent_seal policy
SEAL_ALLOWLIST_ID=0x6c57a61e6f0ab5af7bf1b6dbb459b2baf1033c104cb05c0290915e321450fc79
SEAL_KEY_SERVERS=0x<KEY_SERVER_OBJECT_ID>   # your self-hosted server
SEAL_THRESHOLD=1                            # single server
# no SEAL_API_KEY / SEAL_AGGREGATOR_URL (open-mode independent server)
```
Verify a round-trip against your live server (mirrors the testnet proof we ran):
```bash
bun run - <<'TS'
process.env.SNAPSHOT_ENCRYPTION="seal";
const { SealCipher } = await import("./apps/operator/src/storage/seal.ts");
const c = await SealCipher.fromEnv();
const id="auditor.slopstock.eth";
const pt=new TextEncoder().encode("mainnet self-host round-trip");
const back=await c.decrypt(await c.encrypt(pt,id), id);
console.log(back.length===pt.length && back.every((b,i)=>b===pt[i]) ? "✅ Seal mainnet round-trip OK" : "❌");
TS
```
Once green, the operator's snapshot path is Seal-encrypted on mainnet and the single
`AGENT_SNAPSHOT_KEY` dependency is gone (it stays only as the AES disaster-recovery backup).

## Rollback
Set `SNAPSHOT_ENCRYPTION=aes` (or `SEAL_NETWORK=testnet`) and restart. The key server can stop;
existing AES/testnet snapshots are unaffected.
