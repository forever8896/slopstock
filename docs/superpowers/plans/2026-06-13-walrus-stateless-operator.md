# Stateless Operator (Walrus + Seal + ENS pointer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the operator stateless — remove the Railway disk volume by storing every agent's brain (skills, memory, receipts) on Walrus, threshold-encrypted with Seal, addressed by a mutable `agent-snapshot` ENS text record.

**Architecture:** A pluggable `SnapshotCipher` (`aes` | `seal`) sits between the existing `snapshot.ts` tar/untar and `WalrusStorage`. After each state-changing task the operator exports the agent's receipts into its state dir, tars + encrypts + uploads to Walrus, and (on significant change / shutdown) writes the blobId into the agent's ENS `agent-snapshot` record on mainnet. On cold start, `load()` resolves the pointer from ENS instead of a local file, fetches from Walrus, decrypts, and re-ingests receipts. The volume becomes an optional cache.

**Tech Stack:** Bun, TypeScript, viem (ENS mainnet), `@mysten/seal` + `@mysten/sui` (threshold encryption + session key), Walrus raw HTTP, SQLite (`bun:sqlite`).

**Spec:** [`docs/superpowers/specs/2026-06-13-walrus-stateless-operator-design.md`](../specs/2026-06-13-walrus-stateless-operator-design.md)

---

## File structure

| File | Responsibility | New/Modify |
|---|---|---|
| `apps/operator/src/storage/encryption.ts` | `SnapshotCipher` interface + `AesCipher` + `getSnapshotCipher()` flag switch | Create |
| `apps/operator/src/storage/seal.ts` | `SealCipher` — `@mysten/seal` wrapper (encrypt/decrypt, session key, key servers, seal_approve PTB) | Create |
| `apps/operator/src/storage/snapshot.ts` | tar → cipher → Walrus / Walrus → cipher → untar (swap `CryptoKey` param → `SnapshotCipher`) | Modify |
| `apps/operator/src/store/snapshot-pointer.ts` | `setSnapshotPointer()` / `readSnapshotPointer()` — ENS mainnet text record `agent-snapshot` | Create |
| `apps/operator/src/store/receipt-export.ts` | `exportAgentReceipts(tokenId)` → ndjson string; `importAgentReceipts(ndjson)` → upsert | Create |
| `apps/operator/src/runtime/hermes.ts` | snapshot write path (L320–344) + restore-on-missing (L165–191) | Modify |
| `apps/operator/src/config.ts` | new env: `SNAPSHOT_ENCRYPTION`, `SEAL_*`, `SUI_SEAL_KEYPAIR`, `ENS_SNAPSHOT_ENABLED`, `L1_RPC` | Modify |
| `move/agent_seal/sources/allowlist.move` | Seal `seal_approve` allowlist policy (adapted from Seal example) | Create |
| `apps/operator/scripts/seal-publish-policy.ts` | publish the Move package, create allowlist object, add operator Sui address | Create |
| `apps/operator/scripts/amnesia-demo.ts` | full `rm -rf data/agents/` → restore purely from ENS+Walrus+Seal | Create |
| `.env.example` | document all new env vars | Modify |

**Convention reminders:** tests are colocated `*.test.ts`; run with `bun test <path>`. Live/network tests are guarded by an env flag and skipped when unset (mirror existing `walrus-storage.test.ts`). Commit after every green step.

---

## Phase A — Pluggable encryption (`SnapshotCipher`)

### Task A1: `SnapshotCipher` interface + `AesCipher` wrapping existing crypto

**Files:**
- Create: `apps/operator/src/storage/encryption.ts`
- Test: `apps/operator/src/storage/encryption.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/operator/src/storage/encryption.test.ts
import { test, expect } from "bun:test";
import { AesCipher } from "./encryption.ts";
import { generateKey, exportKeyToBase64 } from "./crypto.ts";

test("AesCipher round-trips bytes; id is ignored", async () => {
  const keyB64 = await exportKeyToBase64(await generateKey());
  const cipher = await AesCipher.fromBase64(keyB64);
  const plain = new TextEncoder().encode("hermes brain bytes");
  const sealed = await cipher.encrypt(plain, "3");
  expect(Buffer.from(sealed).equals(Buffer.from(plain))).toBe(false);
  const back = await cipher.decrypt(sealed, "3");
  expect(new TextDecoder().decode(back)).toBe("hermes brain bytes");
});

test("AesCipher decrypt with wrong key throws", async () => {
  const a = await AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
  const b = await AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
  const sealed = await a.encrypt(new TextEncoder().encode("x"), "3");
  await expect(b.decrypt(sealed, "3")).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/operator/src/storage/encryption.test.ts`
Expected: FAIL — `Cannot find module './encryption.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/operator/src/storage/encryption.ts
/**
 * SnapshotCipher — pluggable encryption for agent state snapshots.
 * Selected by SNAPSHOT_ENCRYPTION (aes | seal). AES is the offline/CI default
 * and the disaster-recovery fallback; Seal is the live/demo + bounty path.
 */
import {
  encrypt as aesEncrypt,
  decrypt as aesDecrypt,
  serializeEnvelope,
  deserializeEnvelope,
  importKeyFromBase64,
} from "./crypto.ts";

export interface SnapshotCipher {
  /** Encrypt plaintext → serialized envelope bytes (stored on Walrus). `id` scopes the agent (Seal identity). */
  encrypt(plaintext: Uint8Array, id: string): Promise<Uint8Array>;
  /** Decrypt serialized envelope bytes → plaintext. */
  decrypt(bytes: Uint8Array, id: string): Promise<Uint8Array>;
  readonly kind: "aes" | "seal";
}

export class AesCipher implements SnapshotCipher {
  readonly kind = "aes" as const;
  private constructor(private readonly key: CryptoKey) {}

  static async fromBase64(b64: string): Promise<AesCipher> {
    return new AesCipher(await importKeyFromBase64(b64));
  }

  async encrypt(plaintext: Uint8Array, _id: string): Promise<Uint8Array> {
    return serializeEnvelope(await aesEncrypt(this.key, plaintext));
  }

  async decrypt(bytes: Uint8Array, _id: string): Promise<Uint8Array> {
    return aesDecrypt(this.key, deserializeEnvelope(bytes));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/operator/src/storage/encryption.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/storage/encryption.ts apps/operator/src/storage/encryption.test.ts
git commit -m "feat(storage): SnapshotCipher interface + AesCipher (wraps crypto.ts)"
```

### Task A2: `getSnapshotCipher()` flag switch (defaults to aes)

**Files:**
- Modify: `apps/operator/src/storage/encryption.ts`
- Test: `apps/operator/src/storage/encryption.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to encryption.test.ts
import { getSnapshotCipher } from "./encryption.ts";
import { generateKey, exportKeyToBase64 } from "./crypto.ts";

test("getSnapshotCipher returns aes when SNAPSHOT_ENCRYPTION unset", async () => {
  const prevEnc = process.env["SNAPSHOT_ENCRYPTION"];
  const prevKey = process.env["AGENT_SNAPSHOT_KEY"];
  delete process.env["SNAPSHOT_ENCRYPTION"];
  process.env["AGENT_SNAPSHOT_KEY"] = await exportKeyToBase64(await generateKey());
  const cipher = await getSnapshotCipher();
  expect(cipher.kind).toBe("aes");
  if (prevEnc === undefined) delete process.env["SNAPSHOT_ENCRYPTION"]; else process.env["SNAPSHOT_ENCRYPTION"] = prevEnc;
  if (prevKey === undefined) delete process.env["AGENT_SNAPSHOT_KEY"]; else process.env["AGENT_SNAPSHOT_KEY"] = prevKey;
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/operator/src/storage/encryption.test.ts`
Expected: FAIL — `getSnapshotCipher is not a function`.

- [ ] **Step 3: Implement**

```ts
// append to encryption.ts
import { SealCipher } from "./seal.ts";

/**
 * Build the SnapshotCipher selected by SNAPSHOT_ENCRYPTION.
 *   aes  (default) — AesCipher from AGENT_SNAPSHOT_KEY (base64url)
 *   seal           — SealCipher (threshold IBE over Mysten open key servers)
 * If AGENT_SNAPSHOT_KEY is unset for aes, a per-process key is generated
 * (snapshots only survive restarts if the env var is set).
 */
export async function getSnapshotCipher(): Promise<SnapshotCipher> {
  const mode = process.env["SNAPSHOT_ENCRYPTION"] ?? "aes";
  if (mode === "seal") return SealCipher.fromEnv();
  const b64 = process.env["AGENT_SNAPSHOT_KEY"];
  if (b64) return AesCipher.fromBase64(b64);
  const { generateKey, exportKeyToBase64 } = await import("./crypto.ts");
  return AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
}
```

> NOTE: `./seal.ts` is created in Task A3. Until then this import fails to resolve at runtime only when `mode === "seal"`; the aes test does not touch it. If your bundler eagerly resolves the static import, temporarily stub `seal.ts` with `export class SealCipher { static async fromEnv(){throw new Error("seal not built")} }` and replace it fully in A3.

- [ ] **Step 4: Create the seal.ts stub so the import resolves**

```ts
// apps/operator/src/storage/seal.ts  (stub — replaced in Task A3)
import type { SnapshotCipher } from "./encryption.ts";
export class SealCipher implements SnapshotCipher {
  readonly kind = "seal" as const;
  static async fromEnv(): Promise<SealCipher> { throw new Error("SealCipher not implemented yet (Task A3)"); }
  async encrypt(): Promise<Uint8Array> { throw new Error("not impl"); }
  async decrypt(): Promise<Uint8Array> { throw new Error("not impl"); }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test apps/operator/src/storage/encryption.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/storage/encryption.ts apps/operator/src/storage/seal.ts apps/operator/src/storage/encryption.test.ts
git commit -m "feat(storage): getSnapshotCipher flag switch (aes default) + seal stub"
```

### Task A3: `SealCipher` — `@mysten/seal` threshold encryption

**Files:**
- Modify: `apps/operator/src/storage/seal.ts` (replace stub)
- Test: `apps/operator/src/storage/seal.test.ts`

- [ ] **Step 1: Install deps**

Run: `bun add @mysten/seal @mysten/sui`
Expected: both added to `apps/operator` (or root) `package.json`.

- [ ] **Step 2: Write the failing test (guarded live integration)**

```ts
// apps/operator/src/storage/seal.test.ts
import { test, expect } from "bun:test";
import { SealCipher } from "./seal.ts";

const LIVE = process.env["SEAL_LIVE_TEST"] === "1"; // set with real SEAL_* env to run

test.if(LIVE)("SealCipher round-trips via testnet key servers", async () => {
  const cipher = await SealCipher.fromEnv();
  const plain = new TextEncoder().encode("sealed hermes brain");
  const sealed = await cipher.encrypt(plain, "3");
  expect(Buffer.from(sealed).equals(Buffer.from(plain))).toBe(false);
  const back = await cipher.decrypt(sealed, "3");
  expect(new TextDecoder().decode(back)).toBe("sealed hermes brain");
}, 60_000);

test("SealCipher.fromEnv throws a clear error when SEAL_PACKAGE_ID unset", async () => {
  const prev = process.env["SEAL_PACKAGE_ID"];
  delete process.env["SEAL_PACKAGE_ID"];
  await expect(SealCipher.fromEnv()).rejects.toThrow(/SEAL_PACKAGE_ID/);
  if (prev !== undefined) process.env["SEAL_PACKAGE_ID"] = prev;
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test apps/operator/src/storage/seal.test.ts`
Expected: FAIL — stub throws "not implemented" / missing env-validation error.

- [ ] **Step 4: Implement `SealCipher`**

```ts
// apps/operator/src/storage/seal.ts
/**
 * SealCipher — agent-state encryption via Mysten Seal threshold IBE.
 *
 * encrypt: client-side hybrid IBE, no Sui tx. decrypt: dry-run of the
 * seal_approve policy via the operator SessionKey, no gas. Key servers are
 * Mysten open-mode (getAllowlistedKeyServers) — no self-hosting.
 *
 * id layout (allowlist policy): [allowlistId bytes] ++ [utf8(tokenId)] so the
 * Move seal_approve can assert the id is prefixed by the allowlist object id.
 */
import { SealClient, SessionKey, getAllowlistedKeyServers } from "@mysten/seal";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import type { SnapshotCipher } from "./encryption.ts";

type SealNetwork = "testnet" | "mainnet";

export class SealCipher implements SnapshotCipher {
  readonly kind = "seal" as const;

  private constructor(
    private readonly client: SealClient,
    private readonly suiClient: SuiClient,
    private readonly keypair: Ed25519Keypair,
    private readonly packageId: string,
    private readonly allowlistId: string,
    private readonly threshold: number,
  ) {}

  static async fromEnv(): Promise<SealCipher> {
    const packageId = req("SEAL_PACKAGE_ID");
    const allowlistId = req("SEAL_ALLOWLIST_ID");
    const secret = req("SUI_SEAL_KEYPAIR"); // suiprivkey... or hex
    const network = (process.env["SEAL_NETWORK"] ?? "testnet") as SealNetwork;
    const threshold = Number(process.env["SEAL_THRESHOLD"] ?? "2");

    const suiClient = new SuiClient({ url: getFullnodeUrl(network) });
    const serverConfigs = getAllowlistedKeyServers(network).map((objectId) => ({ objectId, weight: 1 }));
    const client = new SealClient({ suiClient, serverConfigs, verifyKeyServers: false });
    const keypair = secret.startsWith("suiprivkey")
      ? Ed25519Keypair.fromSecretKey(secret)
      : Ed25519Keypair.fromSecretKey(fromHex(secret.replace(/^0x/, "")));
    return new SealCipher(client, suiClient, keypair, packageId, allowlistId, threshold);
  }

  /** id bytes = allowlistId ++ utf8(tokenId). */
  private idBytes(tokenId: string): Uint8Array {
    const prefix = fromHex(this.allowlistId.replace(/^0x/, ""));
    const suffix = new TextEncoder().encode(tokenId);
    const out = new Uint8Array(prefix.length + suffix.length);
    out.set(prefix, 0);
    out.set(suffix, prefix.length);
    return out;
  }

  async encrypt(plaintext: Uint8Array, id: string): Promise<Uint8Array> {
    const { encryptedObject } = await this.client.encrypt({
      threshold: this.threshold,
      packageId: this.packageId,
      id: toHexNoPrefix(this.idBytes(id)),
      data: plaintext,
    });
    return encryptedObject;
  }

  async decrypt(bytes: Uint8Array, id: string): Promise<Uint8Array> {
    const sessionKey = await SessionKey.create({
      address: this.keypair.toSuiAddress(),
      packageId: this.packageId,
      ttlMin: 10,
      suiClient: this.suiClient,
    });
    const { signature } = await this.keypair.signPersonalMessage(sessionKey.getPersonalMessage());
    sessionKey.setPersonalMessageSignature(signature);

    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::allowlist::seal_approve`,
      arguments: [tx.pure.vector("u8", Array.from(this.idBytes(id))), tx.object(this.allowlistId)],
    });
    const txBytes = await tx.build({ client: this.suiClient, onlyTransactionKind: true });
    return this.client.decrypt({ data: bytes, sessionKey, txBytes });
  }
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`SealCipher: ${name} is required (set it in operator env)`);
  return v;
}

function toHexNoPrefix(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
```

> The `allowlist::seal_approve` target + argument order must match the published Move module (Task E1). If you adapt a different example module name, update the `target` string here to match.

- [ ] **Step 5: Run the offline test**

Run: `bun test apps/operator/src/storage/seal.test.ts`
Expected: PASS — the env-validation test passes; the live test is skipped (LIVE=false).

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/storage/seal.ts apps/operator/src/storage/seal.test.ts apps/operator/package.json
git commit -m "feat(storage): SealCipher — @mysten/seal threshold IBE (gasless encrypt/decrypt)"
```

### Task A4: Switch `snapshot.ts` to use `SnapshotCipher`

**Files:**
- Modify: `apps/operator/src/storage/snapshot.ts`
- Modify: `apps/operator/src/storage/snapshot.test.ts`

- [ ] **Step 1: Update the test to pass a cipher**

```ts
// snapshot.test.ts — replace CryptoKey usage with AesCipher
import { AesCipher } from "./encryption.ts";
import { generateKey, exportKeyToBase64 } from "./crypto.ts";

async function testCipher() {
  return AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
}
// In each test, replace `const key = await generateKey()` with `const cipher = await testCipher()`,
// `snapshotAgentDir(dir, key)` with `snapshotAgentDir(dir, cipher, "3")`,
// and `restoreAgentDir(target, blobId, key)` with `restoreAgentDir(target, blobId, cipher, "3")`.
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/operator/src/storage/snapshot.test.ts`
Expected: FAIL — `snapshotAgentDir` still expects a `CryptoKey`, type/arg mismatch.

- [ ] **Step 3: Update `snapshot.ts` signatures**

```ts
// snapshot.ts — change imports and the two exported function signatures
import type { SnapshotCipher } from "./encryption.ts";
// remove: import { encrypt, decrypt, serializeEnvelope, deserializeEnvelope } from "./crypto.ts";

export async function snapshotAgentDir(agentDir: string, cipher: SnapshotCipher, id: string): Promise<string> {
  if (!existsSync(agentDir)) throw new Error(`snapshot: agent dir does not exist: ${agentDir}`);
  const tarBytes = await tarDir(agentDir);
  const encryptedBytes = await cipher.encrypt(tarBytes, id);
  return walrus.storeBytes(encryptedBytes);
}

export async function restoreAgentDir(targetDir: string, blobId: string, cipher: SnapshotCipher, id: string): Promise<void> {
  const encryptedBytes = await walrus.readBytes(blobId);
  const tarBytes = await cipher.decrypt(encryptedBytes, id);
  await mkdir(targetDir, { recursive: true });
  await untarDir(tarBytes, targetDir);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/operator/src/storage/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/storage/snapshot.ts apps/operator/src/storage/snapshot.test.ts
git commit -m "refactor(storage): snapshot.ts takes SnapshotCipher (aes|seal) not raw CryptoKey"
```

---

## Phase B — ENS snapshot pointer (mainnet)

### Task B1: `setSnapshotPointer` / `readSnapshotPointer`

**Files:**
- Create: `apps/operator/src/store/snapshot-pointer.ts`
- Test: `apps/operator/src/store/snapshot-pointer.test.ts`

- [ ] **Step 1: Write the failing test (logic-level, no live RPC)**

```ts
// apps/operator/src/store/snapshot-pointer.test.ts
import { test, expect } from "bun:test";
import { SNAPSHOT_TEXT_KEY, buildPointerRecords } from "./snapshot-pointer.ts";

test("snapshot pointer uses the agent-snapshot text key", () => {
  expect(SNAPSHOT_TEXT_KEY).toBe("agent-snapshot");
});

test("buildPointerRecords produces a single text record for the blobId", () => {
  const recs = buildPointerRecords("abc123blob");
  expect(recs).toEqual([{ key: "agent-snapshot", value: "abc123blob" }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/operator/src/store/snapshot-pointer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/operator/src/store/snapshot-pointer.ts
/**
 * ENS snapshot pointer — the mutable layer that lets a stateless operator find
 * each agent's latest Walrus snapshot. One text record per agent subname:
 *   agent-snapshot = <walrusBlobId>
 * Public pointer, sealed bytes. Written on mainnet via the existing
 * setTextRecords path; read via the PublicResolver `text` call.
 */
import { createPublicClient, http, namehash, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { setTextRecords, type TextRecord } from "./ens-subname.ts";

export const SNAPSHOT_TEXT_KEY = "agent-snapshot" as const;
const PUBLIC_RESOLVER_MAINNET = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41" as Hex;
const RESOLVER_TEXT_ABI = [{
  type: "function", name: "text", stateMutability: "view",
  inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }],
  outputs: [{ type: "string" }],
}] as const;

export function buildPointerRecords(blobId: string): TextRecord[] {
  return [{ key: SNAPSHOT_TEXT_KEY, value: blobId }];
}

/** Write the latest snapshot blobId into the agent's ENS record (mainnet tx). */
export async function setSnapshotPointer(opts: {
  ensName: string; blobId: string; deployerKey: Hex; rpcUrl: string;
}): Promise<void> {
  await setTextRecords({
    ensName: opts.ensName,
    records: buildPointerRecords(opts.blobId),
    deployerKey: opts.deployerKey,
    rpcUrl: opts.rpcUrl,
    network: "mainnet",
  });
}

/** Read the agent's latest snapshot blobId from ENS, or null if unset. */
export async function readSnapshotPointer(opts: { ensName: string; rpcUrl: string }): Promise<string | null> {
  const client = createPublicClient({ chain: mainnet, transport: http(opts.rpcUrl) });
  const value = (await client.readContract({
    address: PUBLIC_RESOLVER_MAINNET,
    abi: RESOLVER_TEXT_ABI,
    functionName: "text",
    args: [namehash(opts.ensName.toLowerCase()), SNAPSHOT_TEXT_KEY],
  })) as string;
  return value && value.length > 0 ? value : null;
}
```

> Confirm `setTextRecords`' option field is named `deployerKey` and `rpcUrl` by reading `apps/operator/src/store/ens-subname.ts:241` (`SetTextRecordsOpts`). If the field names differ, match them here.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/operator/src/store/snapshot-pointer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/store/snapshot-pointer.ts apps/operator/src/store/snapshot-pointer.test.ts
git commit -m "feat(ens): agent-snapshot pointer — setSnapshotPointer/readSnapshotPointer (mainnet)"
```

---

## Phase C — Receipts fold-in

### Task C1: `exportAgentReceipts` / `importAgentReceipts`

**Files:**
- Create: `apps/operator/src/store/receipt-export.ts`
- Test: `apps/operator/src/store/receipt-export.test.ts`

`receipts.db` already has `tokenId` + `walrusBlobId` + index `(tokenId, ts)` — no migration. Use existing `recordReceipt` / `listReceipts` from `./receipts.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/operator/src/store/receipt-export.test.ts
import { test, expect, beforeEach } from "bun:test";
import { recordReceipt, listReceipts } from "./receipts.ts";
import { exportAgentReceipts, importAgentReceipts } from "./receipt-export.ts";

function fakeReceipt(callId: string, tokenId: bigint) {
  return {
    callId, tokenId, subscriber: "0xabc", ts: 1700000000,
    inputHash: "0x1", outputHash: "0x2", transcript: [], bundleHashBefore: "a",
    bundleHashAfter: "b", stateDeltaHash: "c", skillsLoaded: [], skillsCreated: [],
    measurement: "m", teeQuote: "q", teeVendor: "intel-tdx", model: "deepseek", output: "ok",
  } as any;
}

beforeEach(() => { process.env["RECEIPTS_DB_PATH"] = ":memory:"; });

test("export then import round-trips an agent's receipts", () => {
  recordReceipt(fakeReceipt("call-1", 3n));
  recordReceipt(fakeReceipt("call-2", 3n));
  recordReceipt(fakeReceipt("other", 5n)); // different agent — must NOT be exported
  const ndjson = exportAgentReceipts(3n);
  expect(ndjson.trim().split("\n").length).toBe(2);

  process.env["RECEIPTS_DB_PATH"] = ":memory:"; // fresh DB (simulate cold start)
  importAgentReceipts(ndjson);
  const restored = listReceipts({ tokenId: 3n });
  expect(restored.map((r) => r.callId).sort()).toEqual(["call-1", "call-2"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/operator/src/store/receipt-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/operator/src/store/receipt-export.ts
/**
 * Receipt fold-in for stateless operation. Each agent's receipts are exported
 * into its state dir (receipts.ndjson) before a snapshot, and re-ingested on
 * restore — so receipts.db becomes a rebuildable cache, not durable state.
 */
import { recordReceipt, listReceipts } from "./receipts.ts";
import type { InferenceReceipt } from "@stratum/shared";

/** Serialize this agent's receipts as newline-delimited JSON (newest-first irrelevant). */
export function exportAgentReceipts(tokenId: bigint): string {
  const rows = listReceipts({ tokenId });
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

/** Re-ingest receipts from ndjson (INSERT OR REPLACE via recordReceipt). */
export function importAgentReceipts(ndjson: string): number {
  let n = 0;
  for (const line of ndjson.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const r = JSON.parse(t) as InferenceReceipt;
    recordReceipt({ ...r, tokenId: BigInt((r as any).tokenId) });
    n++;
  }
  return n;
}
```

> Verify `listReceipts` accepts `{ tokenId: bigint }` (see `ListReceiptsOpts` at `receipts.ts:95`). If it filters by string, pass `tokenId.toString()`. Verify `InferenceReceipt.tokenId` is a `bigint` after JSON round-trip — JSON stringifies bigint via the receipt's own serializer; if `recordReceipt` already calls `.toString()`, the `BigInt(...)` re-coercion above keeps it a bigint for the API.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/operator/src/store/receipt-export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/store/receipt-export.ts apps/operator/src/store/receipt-export.test.ts
git commit -m "feat(receipts): export/import per-agent receipts (fold-in for stateless restore)"
```

---

## Phase D — Hermes wiring

### Task D1: Add config + a `pointerWriter` seam (testable without mainnet)

**Files:**
- Modify: `apps/operator/src/config.ts`
- Test: `apps/operator/src/config.test.ts` (append, if present; else create)

- [ ] **Step 1: Write the failing test**

```ts
// config.test.ts — assert new fields parse with defaults
import { test, expect } from "bun:test";
import { loadConfig } from "./config.ts";

test("config exposes snapshot-encryption + ENS-pointer fields with safe defaults", () => {
  const c = loadConfig({ /* pass the minimal required env your loadConfig needs */ } as any);
  expect(c.SNAPSHOT_ENCRYPTION).toBe("aes");
  expect(c.ENS_SNAPSHOT_ENABLED).toBe(false);
});
```

> Read `config.ts` to match how config is constructed (zod schema + `loadConfig`/`parseEnv`). Mirror the existing pattern exactly; the assertions above are the contract.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/operator/src/config.test.ts`
Expected: FAIL — fields undefined.

- [ ] **Step 3: Implement (add to the zod schema)**

```ts
// config.ts — add inside the schema object
  SNAPSHOT_ENCRYPTION: z.enum(["aes", "seal"]).default("aes"),
  ENS_SNAPSHOT_ENABLED: z.coerce.boolean().default(false), // write agent-snapshot pointer on mainnet
  L1_RPC: z.string().default(""),                          // mainnet RPC for ENS pointer reads/writes
  SEAL_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  SEAL_PACKAGE_ID: z.string().default(""),
  SEAL_ALLOWLIST_ID: z.string().default(""),
  SEAL_THRESHOLD: z.coerce.number().default(2),
  SUI_SEAL_KEYPAIR: z.string().default(""),
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/operator/src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/config.ts apps/operator/src/config.test.ts
git commit -m "feat(config): snapshot-encryption + ENS-pointer + SEAL_* env"
```

### Task D2: Snapshot write path — cipher + receipts export + debounced ENS pointer

**Files:**
- Modify: `apps/operator/src/runtime/hermes.ts` (the `if (stateChanged) { ... }` block, L320–344, and add a module-level pointer scheduler + `getSnapshotKey` replacement)

- [ ] **Step 1: Replace `getSnapshotKey()` usage with `getSnapshotCipher()`**

In `hermes.ts`, remove the `getSnapshotKey` helper (L397–416) and its `_snapshotKey` cache. Import the cipher and a per-process `lastPublishedHash` map:

```ts
import { getSnapshotCipher } from "../storage/encryption.ts";
import { exportAgentReceipts } from "../store/receipt-export.ts";
import { setSnapshotPointer } from "../store/snapshot-pointer.ts";
import { writeFile as writeFileAsync } from "node:fs/promises";

const _lastPublishedHash = new Map<string, string>(); // tokenId → last ENS-published bundleHash
let _pendingPointer: { ensName: string; blobId: string } | null = null; // flushed on shutdown
```

- [ ] **Step 2: Rewrite the `if (stateChanged)` snapshot block**

```ts
    if (stateChanged) {
      const tokenKey = req.tokenId.toString();
      // Export this agent's receipts INTO its state dir so the tar captures them.
      try {
        await writeFileAsync(join(state.dir, "receipts.ndjson"), exportAgentReceipts(req.tokenId));
      } catch (e) {
        console.warn(`[hermes] receipts export failed tokenId=${tokenKey}: ${(e as Error).message}`);
      }
      getSnapshotCipher()
        .then((cipher) => snapshotAgentDir(state.dir, cipher, tokenKey))
        .then(async (blobId) => {
          state.lock.walrusSnapshotBlobId = blobId;
          await writeFileAsync(join(state.dir, "bundle.lock.json"), JSON.stringify(state.lock, null, 2));
          console.log(`[hermes] snapshot tokenId=${tokenKey} → walrus:${blobId.slice(0, 16)}…`);
          // ENS pointer: only on significant change, only if enabled + named.
          const ensName = this.ensNameFor?.(req.tokenId);
          if (ensName && this.config.ENS_SNAPSHOT_ENABLED && this.config.L1_RPC && this.config.DEPLOYER_PRIVATE_KEY) {
            if (_lastPublishedHash.get(tokenKey) !== bundleHashAfter) {
              _pendingPointer = { ensName, blobId };
              try {
                await setSnapshotPointer({
                  ensName, blobId,
                  deployerKey: this.config.DEPLOYER_PRIVATE_KEY as `0x${string}`,
                  rpcUrl: this.config.L1_RPC,
                });
                _lastPublishedHash.set(tokenKey, bundleHashAfter);
                _pendingPointer = null;
                console.log(`[hermes] ENS agent-snapshot ${ensName} → ${blobId.slice(0, 16)}…`);
              } catch (e) {
                console.warn(`[hermes] ENS pointer write failed ${ensName}: ${(e as Error).message}`);
              }
            }
          }
        })
        .catch((e) => console.warn(`[hermes] snapshot failed tokenId=${tokenKey}: ${(e as Error).message}`));
    }
```

> `this.ensNameFor(tokenId)` resolves an agent's subname. If the class has no such map yet, add a minimal one: a constructor-injected `ensNameByToken?: Record<string,string>` populated from the dynamic registry (`registry.json` `ensName` field) / a static map for AUDIT(`auditor`)/ORCL(`oracles`). Confirm `this.config.DEPLOYER_PRIVATE_KEY` is the field name in config (grep `DEPLOYER`); match it.

- [ ] **Step 3: Remove the local `.snapshot` sibling write**

Delete the `const snapshotFile = \`${state.dir}.snapshot\`; await writeFile(snapshotFile, ...)` lines (old L332–334). The ENS record is now the durable pointer.

- [ ] **Step 4: Run the operator test suite**

Run: `bun test apps/operator`
Expected: PASS (existing hermes tests still green; snapshot is async + guarded by `ENS_SNAPSHOT_ENABLED=false` default, so no mainnet calls in tests).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/hermes.ts
git commit -m "feat(hermes): snapshot via cipher + receipts fold-in + debounced ENS pointer"
```

### Task D3: Restore-on-missing reads the pointer from ENS

**Files:**
- Modify: `apps/operator/src/runtime/hermes.ts` (the restore block, L165–191)

- [ ] **Step 1: Rewrite the restore-on-missing block**

```ts
    if (!this.manifestOverride && !existsSync(dir)) {
      const ensName = this.ensNameFor?.(opts.tokenId);
      if (ensName && this.config.L1_RPC) {
        try {
          const blobId = await readSnapshotPointer({ ensName, rpcUrl: this.config.L1_RPC });
          if (blobId) {
            console.log(`[hermes] restoring tokenId=${opts.tokenId} from ENS ${ensName} → walrus:${blobId.slice(0, 16)}…`);
            const cipher = await getSnapshotCipher();
            await restoreAgentDir(dir, blobId, cipher, opts.tokenId.toString());
            // Re-ingest receipts captured in the snapshot.
            const receiptsFile = join(dir, "receipts.ndjson");
            if (existsSync(receiptsFile)) {
              importAgentReceipts(await readFile(receiptsFile, "utf-8"));
            }
            console.log(`[hermes] restore complete for tokenId=${opts.tokenId}`);
          }
        } catch (e) {
          console.warn(`[hermes] ENS/Walrus restore failed, falling back to seed: ${(e as Error).message}`);
        }
      }
    }
```

Add imports at top: `import { readSnapshotPointer } from "../store/snapshot-pointer.ts";` and `import { importAgentReceipts } from "../store/receipt-export.ts";` (and ensure `readFile` from `node:fs/promises` is imported — it already is).

- [ ] **Step 2: Run the suite**

Run: `bun test apps/operator`
Expected: PASS — restore path is guarded by `L1_RPC` (empty in tests → skipped), so seed fallback still drives existing tests.

- [ ] **Step 3: Commit**

```bash
git add apps/operator/src/runtime/hermes.ts
git commit -m "feat(hermes): restore-on-missing resolves snapshot blobId from ENS (no local pointer)"
```

### Task D4: Graceful-shutdown pointer flush

**Files:**
- Modify: `apps/operator/src/index.ts` (operator entrypoint — add SIGTERM/SIGINT handler)

- [ ] **Step 1: Add the handler near server startup**

```ts
// apps/operator/src/index.ts — after the server starts
import { flushPendingPointer } from "./runtime/hermes.ts";

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    console.log(`[operator] ${sig} — flushing pending ENS snapshot pointer…`);
    try { await flushPendingPointer(); } catch (e) { console.warn(`flush failed: ${(e as Error).message}`); }
    process.exit(0);
  });
}
```

- [ ] **Step 2: Export `flushPendingPointer` from hermes.ts**

```ts
// hermes.ts — module-level export
export async function flushPendingPointer(): Promise<void> {
  if (!_pendingPointer) return;
  const { ensName, blobId } = _pendingPointer;
  const rpc = process.env["L1_RPC"]; const key = process.env["DEPLOYER_PRIVATE_KEY"];
  if (!rpc || !key) return;
  await setSnapshotPointer({ ensName, blobId, deployerKey: key as `0x${string}`, rpcUrl: rpc });
  _pendingPointer = null;
}
```

- [ ] **Step 3: Run the suite + typecheck**

Run: `bun test apps/operator && bunx tsc --noEmit -p apps/operator`
Expected: PASS / no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/index.ts apps/operator/src/runtime/hermes.ts
git commit -m "feat(operator): flush pending ENS snapshot pointer on graceful shutdown"
```

---

## Phase E — Sui Move allowlist policy

### Task E1: Author + publish the `agent_seal` allowlist package

**Files:**
- Create: `move/agent_seal/Move.toml`
- Create: `move/agent_seal/sources/allowlist.move`
- Create: `apps/operator/scripts/seal-publish-policy.ts`

> This adapts Mysten's **Seal allowlist example** (`MystenLabs/seal` → `move/` examples). Diff against the upstream example at implementation time; the `seal_approve` signature MUST match what `SealCipher.decrypt` calls (`allowlist::seal_approve(id: vector<u8>, allowlist: &Allowlist)`).

- [ ] **Step 1: `Move.toml`**

```toml
[package]
name = "agent_seal"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }

[addresses]
agent_seal = "0x0"
```

- [ ] **Step 2: `sources/allowlist.move` (allowlist policy)**

```move
module agent_seal::allowlist {
    use sui::dynamic_field as df;

    const ENotInAllowlist: u64 = 1;
    const EInvalidPrefix: u64 = 2;

    public struct Allowlist has key {
        id: UID,
        owner: address,
    }
    public struct Cap has key { id: UID, allowlist_id: ID }

    /// Create an allowlist; sender becomes owner and gets a Cap.
    public fun create(ctx: &mut TxContext): Cap {
        let al = Allowlist { id: object::new(ctx), owner: ctx.sender() };
        let cap = Cap { id: object::new(ctx), allowlist_id: object::id(&al) };
        transfer::share_object(al);
        cap
    }
    entry fun create_entry(ctx: &mut TxContext) { transfer::transfer(create(ctx), ctx.sender()); }

    /// Add an address to the allowlist (only via Cap).
    public fun add(al: &mut Allowlist, cap: &Cap, member: address) {
        assert!(object::id(al) == cap.allowlist_id, ENotInAllowlist);
        df::add(&mut al.id, member, true);
    }
    entry fun add_entry(al: &mut Allowlist, cap: &Cap, member: address) { add(al, cap, member) }

    /// id must be prefixed by the allowlist object id (namespacing).
    fun is_prefix(prefix: vector<u8>, word: vector<u8>): bool {
        if (vector::length(&prefix) > vector::length(&word)) return false;
        let mut i = 0;
        while (i < vector::length(&prefix)) {
            if (*vector::borrow(&prefix, i) != *vector::borrow(&word, i)) return false;
            i = i + 1;
        };
        true
    }

    /// Seal calls this in a dry-run. Approves if caller is allowlisted and the
    /// id is namespaced under this allowlist's object id.
    entry fun seal_approve(id: vector<u8>, al: &Allowlist, ctx: &TxContext) {
        assert!(df::exists_(&al.id, ctx.sender()), ENotInAllowlist);
        assert!(is_prefix(object::id(al).to_bytes(), id), EInvalidPrefix);
    }
}
```

> `seal_approve` takes `(id, allowlist)` plus the implicit `&TxContext`; `SealCipher.decrypt` passes `[pure id, object allowlist]`. The implicit ctx is supplied by the runtime — keep argument order `(id, allowlist)` to match the SDK call.

- [ ] **Step 3: Publish + create allowlist + add operator address (script)**

```ts
// apps/operator/scripts/seal-publish-policy.ts
// Publishes move/agent_seal, creates an Allowlist, adds SUI_SEAL_KEYPAIR's address.
// Prints SEAL_PACKAGE_ID and SEAL_ALLOWLIST_ID to paste into .env.
// Run: bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/seal-publish-policy.ts'
//
// Requires the Sui CLI for the package build/publish step:
//   sui move build --path move/agent_seal
//   sui client publish --gas-budget 100000000 move/agent_seal
// Capture packageId from the publish output, then call create_entry + add_entry
// via @mysten/sui Transaction with the operator keypair (this account needs a
// little testnet SUI for the publish + two calls — faucet it once).
console.log("See inline steps: sui move build/publish, then create_entry + add_entry.");
```

- [ ] **Step 4: Execute publish (manual, one-time)**

Run:
```bash
sui client switch --env testnet
sui client faucet                       # fund SUI_SEAL_KEYPAIR's address once
sui move build --path move/agent_seal
sui client publish --gas-budget 100000000 move/agent_seal
# record packageId → SEAL_PACKAGE_ID
bun run apps/operator/scripts/seal-publish-policy.ts   # create_entry + add_entry, prints SEAL_ALLOWLIST_ID
```
Expected: prints a `SEAL_PACKAGE_ID` (0x…) and `SEAL_ALLOWLIST_ID` (0x…).

- [ ] **Step 5: Commit**

```bash
git add move/agent_seal apps/operator/scripts/seal-publish-policy.ts
git commit -m "feat(seal): agent_seal allowlist Move policy + publish script"
```

### Task E2: Live Seal round-trip green

- [ ] **Step 1: Put the Seal env into `.env`** (`SEAL_PACKAGE_ID`, `SEAL_ALLOWLIST_ID`, `SUI_SEAL_KEYPAIR`, `SEAL_NETWORK=testnet`, `SEAL_THRESHOLD=2`).

- [ ] **Step 2: Run the guarded live test**

Run: `SEAL_LIVE_TEST=1 bun test apps/operator/src/storage/seal.test.ts`
Expected: PASS — encrypt→decrypt round-trips via testnet key servers.

- [ ] **Step 3: No commit (env only).** If round-trip fails, debug `seal_approve` arg order / id prefix before proceeding.

---

## Phase F — Demo + rollout

### Task F1: Amnesia demo script (live, end-to-end)

**Files:**
- Create: `apps/operator/scripts/amnesia-demo.ts`

- [ ] **Step 1: Implement the script**

```ts
// apps/operator/scripts/amnesia-demo.ts
/**
 * Amnesia demo — proves the operator is stateless.
 *   1. seed AUDIT, run a task so it self-learns a skill + writes memory
 *   2. snapshot → Walrus → ENS agent-snapshot pointer (mainnet)
 *   3. rm -rf data/agents/  (TRUE full wipe — no local pointer survives)
 *   4. load(tokenId) → resolves ENS → Walrus → Seal decrypt → restore
 *   5. assert skills + memory.db + receipts byte-identical
 * Run: bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/amnesia-demo.ts'
 */
import { rm } from "node:fs/promises";
// build a Hermes instance with config (ENS_SNAPSHOT_ENABLED=1, L1_RPC, SEAL env),
// run one task, snapshot, capture the ENS pointer, then:
console.log("[amnesia] wiping data/agents/ …");
await rm("./data/agents", { recursive: true, force: true });
console.log("[amnesia] cold load → restore from ENS+Walrus+Seal …");
// load(tokenId); assert hashBundleDir(dir) === bundleHashAfter from the receipt.
```

> Flesh out the Hermes construction to mirror `smoke-hermes`/`smoke-e2e-full-loop.ts` (read one of those for the exact constructor wiring). The assertion compares `hashBundleDir(dir)` before-wipe vs after-restore.

- [ ] **Step 2: Run it**

Run: `bash -c 'set -a && . ./.env && set +a && SNAPSHOT_ENCRYPTION=seal ENS_SNAPSHOT_ENABLED=1 bun run apps/operator/scripts/amnesia-demo.ts'`
Expected: prints the ENS pointer, the wipe, the restore, and `✅ byte-identical`.

- [ ] **Step 3: Commit**

```bash
git add apps/operator/scripts/amnesia-demo.ts
git commit -m "feat(demo): amnesia — stateless restore from ENS+Walrus+Seal"
```

### Task F2: Document env + remove the volume + delete shadow path

**Files:**
- Modify: `.env.example`
- Delete: `apps/operator/src/storage/og-storage-impl.ts` usage (keep the file only if still imported by the `shadow` backend; otherwise remove the dead `og-shadow` writes)
- Modify: `docs/nyc-2026/03-walrus.md` + `docs/nyc-2026/MASTERPLAN.md` (status rows)

- [ ] **Step 1: Append to `.env.example`**

```bash
# ── Stateless operator (Walrus + Seal + ENS pointer) ──
STORAGE_BACKEND=walrus
SNAPSHOT_ENCRYPTION=seal           # aes | seal
AGENT_SNAPSHOT_KEY=                # base64url 32B — AES fallback + Seal backup-key
ENS_SNAPSHOT_ENABLED=1             # write agent-snapshot pointer on mainnet
L1_RPC=                            # mainnet RPC (ENS pointer reads/writes)
SEAL_NETWORK=testnet
SEAL_PACKAGE_ID=
SEAL_ALLOWLIST_ID=
SEAL_THRESHOLD=2
SUI_SEAL_KEYPAIR=                  # unfunded except one-time package publish
WALRUS_EPOCHS=5
```

- [ ] **Step 2: Verify volume-independence locally**

Run:
```bash
rm -rf ./data/agents ./data/receipts.db
bash -c 'set -a && . ./.env && set +a && bun run apps/operator/src/index.ts' &
sleep 3 && curl -s localhost:8402/healthz && curl -s localhost:8402/receipts | head -c 200
```
Expected: healthz OK; first `load` of a named agent rehydrates from ENS+Walrus (watch the `[hermes] restoring …` log).

- [ ] **Step 3: Detach the Railway volume** (Railway dashboard → service → Volumes → detach) and redeploy. Confirm cold boot rehydrates the demo agents. Keep the volume config saved — re-attach is the venue stop-loss.

- [ ] **Step 4: Update plan docs** — set `03-walrus.md` + MASTERPLAN row 03 to reflect Seal + ENS-pointer + stateless operator; mark the amnesia demo done.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/nyc-2026/03-walrus.md docs/nyc-2026/MASTERPLAN.md
git commit -m "docs+ops: stateless operator env, volume removed, masterplan synced"
```

---

## Self-review notes (coverage check)

- Spec §"What lives on the volume" → Tasks A4/D2 (agent state), C1/D2/D3 (receipts), F2 (og-shadow). ✅
- Spec §"Encryption layer (Seal)" → A1–A3 + E1/E2. ✅
- Spec §"ENS record schema" → B1; written D2, read D3. ✅
- Spec §"Snapshot write / cold-start restore / receipts fold-in" → D2 / D3 / C1. ✅
- Spec §"Error handling" (guards, fallbacks) → D2/D3 try-catch + `ENS_SNAPSHOT_ENABLED`/`L1_RPC` guards + AES fallback (A2). ✅
- Spec §"Configuration" → D1 + F2. ✅
- Spec §"Testing" → unit (A,B,C), guarded live (A3/E2), amnesia (F1). ✅
- Spec §"Rollout" → F2. ✅
- Spec §"Acceptance criteria" → F1 (amnesia, encrypted, pointer) + F2 (no volume) + E (Move package, open key servers). ✅

**Known verify-at-implementation points (flagged inline, not placeholders):** exact `SetTextRecordsOpts` field names (B1/D2); `listReceipts` tokenId arg type (C1); `config` field name for the deployer key + `loadConfig` shape (D1/D2); Hermes constructor wiring for `ensNameFor` + the amnesia script (D2/F1); upstream Seal allowlist `seal_approve` signature (E1 ↔ A3).
