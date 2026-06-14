# 12 · Seal on Sui Mainnet — deployment runbook

Status: **code mainnet-ready**. Getting live is an ops sequence (publish + allowlist +
key-server selection), not a code change. Encrypt/decrypt stay gasless on mainnet; only the
one-time package publish and allowlist creation cost SUI gas.

## What changed to make this possible

- **Seal is GA on Sui mainnet.** Verified key-server operators include Ruby Nodes, NodeInfra,
  Studio Mirai, Overclock, H2O Nodes, Triton One, and Enoki (Mysten). The old "no mainnet open-mode
  servers" assumption is obsolete.
- **`SealCipher` is network-agnostic.** `SEAL_NETWORK=mainnet` flips the Sui RPC + Seal client to
  mainnet. The only hard requirement mainnet adds is an explicit `SEAL_KEY_SERVERS` list — there is
  no safe baked-in default (`apps/operator/src/storage/seal-config.ts:resolveKeyServerIds`).
- **`verifyKeyServers` now defaults on for mainnet** (`resolveVerifyKeyServers`): the SDK
  cryptographically confirms each key server is the object it claims. Override with
  `SEAL_VERIFY_KEY_SERVERS=false` only for debugging.
- **Dependency fix:** the modern Mysten SDK needs `@noble/curves@^2`; the EVM stack (viem/ox)
  hard-pins `1.9.1`. The root `package.json` no longer force-pins a single noble version — bun
  nests both majors (1.9.1 for the web/EVM build, 2.x for the operator's Sui stack). Without this,
  `@mysten/seal` fails to import at all.

## Open vs permissioned key servers

- **Open mode** — accepts any package ID. Zero setup; just use the object ID. Best for the demo.
- **Permissioned** — the provider must allowlist your `SEAL_PACKAGE_ID` first, and may require a
  service agreement / charge for a production SLA. Use for real production availability.

Pick **≥ `SEAL_THRESHOLD`** servers (default 2). Mix providers for resilience.

## Deployment sequence

```bash
# 0. Prereqs: `sui` CLI installed, an Ed25519 key in SUI_SEAL_KEYPAIR, real SUI for gas.

# 1. Point the Move package at the mainnet framework.
#    In move/agent_seal/Move.toml: comment the framework/testnet line, uncomment framework/mainnet.

# 2. Build + publish the policy package to mainnet (NO faucet on mainnet — fund the key yourself).
sui client switch --env mainnet
sui move build  --path move/agent_seal
sui client publish --gas-budget 200000000 move/agent_seal
#   -> copy the published packageId  ->  SEAL_PACKAGE_ID

# 3. Create the allowlist + add the operator address (programmatic, via the SDK).
SEAL_NETWORK=mainnet SEAL_PACKAGE_ID=0x... SUI_SEAL_KEYPAIR=... \
  bun run apps/operator/scripts/seal-publish-policy.ts
#   -> prints SEAL_ALLOWLIST_ID (+ admin Cap id — keep the Cap safe)

# 4. Choose mainnet key servers from the Seal "Verified Key Servers" docs page.
#    Need >= SEAL_THRESHOLD of them.  ->  SEAL_KEY_SERVERS=0x<s1>,0x<s2>
```

## Operator env (mainnet)

```bash
SNAPSHOT_ENCRYPTION=seal
SEAL_NETWORK=mainnet
SEAL_PACKAGE_ID=0x...          # from publish (step 2)
SEAL_ALLOWLIST_ID=0x...        # from seal-publish-policy (step 3)
SEAL_KEY_SERVERS=0x..,0x..     # >= SEAL_THRESHOLD verified mainnet servers (step 4)
SEAL_THRESHOLD=2
SUI_SEAL_KEYPAIR=...           # same key added to the allowlist
# SEAL_VERIFY_KEY_SERVERS=     # leave blank -> verification ON for mainnet
AGENT_SNAPSHOT_KEY=...         # base64url 32B — AES disaster-recovery fallback (keep set!)
```

## Verify

```bash
# Pure config + env-validation tests (offline):
bun test apps/operator/src/storage/seal.test.ts

# Live encrypt/decrypt round-trip against the configured (mainnet) key servers:
SEAL_LIVE_TEST=1 bash -c 'set -a && . ./.env && set +a && \
  bun test apps/operator/src/storage/seal.test.ts'

# Full stateless proof — wipe + restore from Walrus, Seal-decrypted, ENS-discovered:
AMNESIA_LIVE=1 bash -c 'set -a && . ./.env && set +a && \
  bun run apps/operator/scripts/amnesia-demo.ts'
```

## Cost & failure model

- **One-time gas:** package publish (~0.1–0.2 SUI) + allowlist create/add. Everything after is gasless
  (encrypt is client-side IBE; decrypt is a dry-run PTB).
- **Package upgrades break decrypt:** the key server pins package version "1". If you upgrade the Move
  package, re-publish the allowlist and update `SEAL_PACKAGE_ID` to the new version-1 objectId — do not
  reuse the old ID (`seal.ts` decrypt note).
- **Fallback:** if mainnet Seal key servers are unavailable, set `SNAPSHOT_ENCRYPTION=aes`
  (AES-256-GCM via `AGENT_SNAPSHOT_KEY`). Snapshots still land on Walrus; only the encryption layer
  changes.
