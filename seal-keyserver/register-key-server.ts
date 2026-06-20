/**
 * Register a self-hosted Seal key server on Sui MAINNET as an Open-mode
 * independent server — no Sui CLI required (uses @mysten/sui + the funded
 * SUI_SEAL_KEYPAIR). One-time on-chain tx (~small SUI gas).
 *
 * Prereqs:
 *   1. Build seal-cli (MystenLabs/seal) and run `seal-cli genkey` → you get a
 *      Master key (SECRET — keep for the server's MASTER_KEY env) and a Public
 *      key (the `pk` you register below).
 *   2. Decide the public HTTPS URL the server will live at (e.g. your Railway
 *      domain). It is baked into the on-chain object and verified by clients.
 *
 * Run (from repo root, .env must have SUI_SEAL_KEYPAIR):
 *   KS_URL=https://seal.your-app.up.railway.app \
 *   KS_PUBKEY=0x<master pubkey from genkey> \
 *   KS_NAME=slopstock-agent-seal \
 *   bun run seal-keyserver/register-key-server.ts
 *
 * Prints the new KeyServer object id → set it as SEAL_KEY_SERVERS in .env.
 */
import { readFileSync } from "node:fs";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";

// Mysten's Seal SYSTEM package on mainnet (where the key_server module lives).
// This is NOT the project's agent_seal policy package (that stays SEAL_PACKAGE_ID).
const SEAL_SYSTEM_PKG_MAINNET =
  "0x931739224160073d8e391c9aa6e7ade9818e9814b4907066b7efa058636c4e45";
const KEY_TYPE_BLS12381 = 0; // KEY_TYPE_BONEH_FRANKLIN_BLS12381

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    for (const line of readFileSync("./.env", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* no .env */ }
  return undefined;
}

const url = env("KS_URL");
const pkHex = env("KS_PUBKEY");
const name = env("KS_NAME") ?? "slopstock-agent-seal";
const secret = env("SUI_SEAL_KEYPAIR");
if (!url) throw new Error("KS_URL required (the public HTTPS URL the key server will be served at)");
if (!pkHex) throw new Error("KS_PUBKEY required (Public key from `seal-cli genkey`)");
if (!secret) throw new Error("SUI_SEAL_KEYPAIR required (in env or .env)");

const keypair = secret.startsWith("suiprivkey")
  ? Ed25519Keypair.fromSecretKey(secret)
  : Ed25519Keypair.fromSecretKey(fromHex(secret.replace(/^0x/, "")));
const pkBytes = fromHex(pkHex.replace(/^0x/, ""));

const client = new SuiJsonRpcClient({ network: "mainnet", url: getJsonRpcFullnodeUrl("mainnet") });

const tx = new Transaction();
tx.moveCall({
  target: `${SEAL_SYSTEM_PKG_MAINNET}::key_server::create_and_transfer_v2_independent_server`,
  arguments: [
    tx.pure.string(name),
    tx.pure.string(url),
    tx.pure.u8(KEY_TYPE_BLS12381),
    tx.pure.vector("u8", Array.from(pkBytes)),
  ],
});

console.log(`registering key server "${name}" @ ${url} (signer ${keypair.toSuiAddress()})…`);
const res = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showObjectChanges: true, showEffects: true },
});
console.log("status:", res.effects?.status?.status, "digest:", res.digest);

const created = (res.objectChanges ?? []).find(
  (c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.includes("::key_server::KeyServer"),
) as { objectId?: string } | undefined;

if (created?.objectId) {
  console.log("\n✅ KeyServer object id:", created.objectId);
  console.log("→ set in .env:  SEAL_KEY_SERVERS=" + created.objectId);
  console.log("   and in your key-server config yaml: key_server_object_id: '" + created.objectId + "'");
} else {
  console.log("\n⚠️ Could not find a created KeyServer object in objectChanges — inspect the tx:", res.digest);
  console.log(JSON.stringify(res.objectChanges, null, 2));
}
