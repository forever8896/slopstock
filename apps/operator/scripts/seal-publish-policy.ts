/**
 * seal-publish-policy.ts — helper for standing up the agent_seal allowlist policy.
 *
 * The Seal policy is a Sui Move package (move/agent_seal). PUBLISHING it requires the
 * Sui CLI + a funded keypair, which is a MANUAL step the operator runs in their own
 * environment. This script does NOT publish the package — Move build/publish has no
 * @mysten/sui equivalent. What it DOES do, once the package is published:
 *
 *   1. read SUI_SEAL_KEYPAIR (the operator's Sui key) + SEAL_PACKAGE_ID (the published
 *      package id) from env,
 *   2. programmatically call  agent_seal::allowlist::create_allowlist_entry  to create a
 *      shared Allowlist (+ Cap sent to the operator),
 *   3. call  agent_seal::allowlist::add_entry  to add the operator's own Sui address to
 *      the allowlist (so SealCipher.decrypt's seal_approve passes for it),
 *   4. print the resulting SEAL_ALLOWLIST_ID (and the Cap id) for the operator env.
 *
 * SAFE TO RUN with missing env: if SUI_SEAL_KEYPAIR or SEAL_PACKAGE_ID is absent, it
 * prints the full manual runbook and exits 0 (no crash, no side effects).
 *
 * ── Full manual deployment sequence ─────────────────────────────────────────────────
 *   sui client switch --env testnet
 *   sui client faucet                      # fund the SUI_SEAL_KEYPAIR address
 *   sui move build --path move/agent_seal
 *   sui client publish --gas-budget 100000000 move/agent_seal   # record packageId -> SEAL_PACKAGE_ID
 *   bun run apps/operator/scripts/seal-publish-policy.ts         # creates allowlist + adds operator addr, prints SEAL_ALLOWLIST_ID
 * ────────────────────────────────────────────────────────────────────────────────────
 *
 * Run (after publish):
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/seal-publish-policy.ts'
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";

type SealNetwork = "testnet" | "mainnet";

const MANUAL_RUNBOOK = `
agent_seal allowlist policy — manual deployment runbook
=======================================================
The Sui Move package must be built & published with the Sui CLI (not available to this
script). Run these in an environment that has \`sui\` installed and a funded key:

  sui client switch --env testnet
  sui client faucet                      # fund the SUI_SEAL_KEYPAIR address
  sui move build --path move/agent_seal
  sui client publish --gas-budget 100000000 move/agent_seal
    # -> copy the published packageId into env as SEAL_PACKAGE_ID

Then set these env vars and re-run this script to create the allowlist:
  SUI_SEAL_KEYPAIR   the operator Sui key (suiprivkey... or 0x-hex 32 bytes)
  SEAL_PACKAGE_ID    the published package id from the publish step
  SEAL_NETWORK       testnet | mainnet  (default: testnet)

  bun run apps/operator/scripts/seal-publish-policy.ts
    # -> prints SEAL_ALLOWLIST_ID (add it to the operator env alongside SEAL_PACKAGE_ID)
`;

function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function loadKeypair(secret: string): Ed25519Keypair {
  return secret.startsWith("suiprivkey")
    ? Ed25519Keypair.fromSecretKey(secret)
    : Ed25519Keypair.fromSecretKey(fromHex(secret.replace(/^0x/, "")));
}

async function main(): Promise<number> {
  const secret = optionalEnv("SUI_SEAL_KEYPAIR");
  const packageId = optionalEnv("SEAL_PACKAGE_ID");
  const network = (optionalEnv("SEAL_NETWORK") ?? "testnet") as SealNetwork;
  const allowlistName = optionalEnv("SEAL_ALLOWLIST_NAME") ?? "agent-operator";

  if (!secret || !packageId) {
    console.log(MANUAL_RUNBOOK);
    console.log(
      `[seal-publish-policy] missing env (${!secret ? "SUI_SEAL_KEYPAIR " : ""}${!packageId ? "SEAL_PACKAGE_ID" : ""}`.trim() +
        ") — printed the manual runbook above and exiting 0 (no-op).",
    );
    return 0;
  }

  if (network !== "testnet" && network !== "mainnet") {
    console.error(`[seal-publish-policy] SEAL_NETWORK must be "testnet" or "mainnet" (got "${network}")`);
    return 1;
  }

  let keypair: Ed25519Keypair;
  try {
    keypair = loadKeypair(secret);
  } catch (e) {
    console.error(`[seal-publish-policy] SUI_SEAL_KEYPAIR is not a valid key: ${(e as Error).message}`);
    return 1;
  }

  const operator = keypair.toSuiAddress();
  const client = new SuiJsonRpcClient({ network, url: getJsonRpcFullnodeUrl(network) });

  console.log(`[seal-publish-policy] network=${network} package=${packageId}`);
  console.log(`[seal-publish-policy] operator Sui address=${operator}`);

  // 1) create the shared Allowlist (+ Cap transferred to the operator).
  const createTx = new Transaction();
  createTx.moveCall({
    target: `${packageId}::allowlist::create_allowlist_entry`,
    arguments: [createTx.pure.string(allowlistName)],
  });
  const created = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: createTx,
    options: { showObjectChanges: true, showEffects: true },
  });
  await client.waitForTransaction({ digest: created.digest });

  const changes = created.objectChanges ?? [];
  const allowlistChange = changes.find(
    (c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.endsWith("::allowlist::Allowlist"),
  );
  const capChange = changes.find(
    (c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.endsWith("::allowlist::Cap"),
  );

  if (!allowlistChange || allowlistChange.type !== "created" || !capChange || capChange.type !== "created") {
    console.error(
      "[seal-publish-policy] could not locate created Allowlist/Cap in object changes — dumping changes:",
    );
    console.error(JSON.stringify(changes, null, 2));
    return 1;
  }

  const allowlistId = allowlistChange.objectId;
  const capId = capChange.objectId;
  console.log(`[seal-publish-policy] created allowlist=${allowlistId} cap=${capId} (digest ${created.digest})`);

  // 2) add the operator's own address to the allowlist so seal_approve passes for it.
  const addTx = new Transaction();
  addTx.moveCall({
    target: `${packageId}::allowlist::add_entry`,
    arguments: [addTx.object(allowlistId), addTx.object(capId), addTx.pure.address(operator)],
  });
  const added = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: addTx,
    options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: added.digest });
  console.log(`[seal-publish-policy] added operator ${operator} to allowlist (digest ${added.digest})`);

  console.log("");
  console.log("=== add these to the operator env ===");
  console.log(`SEAL_PACKAGE_ID=${packageId}`);
  console.log(`SEAL_ALLOWLIST_ID=${allowlistId}`);
  console.log(`# (admin Cap, keep safe) SEAL_ALLOWLIST_CAP=${capId}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[seal-publish-policy] fatal:", e);
    process.exit(1);
  });
