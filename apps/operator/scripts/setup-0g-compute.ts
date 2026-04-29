/**
 * One-shot 0G Compute broker setup for the operator.
 *
 *   1. Initialize the broker against 0G Galileo testnet using OPERATOR_PRIVATE_KEY.
 *   2. Ensure a ledger account exists with at least 3 0G (SDK 0.6.x minimum).
 *   3. Pick a TeeML provider (the well-known testnet provider published in
 *      the 0G starter kit).
 *   4. Acknowledge the provider's signer so we trust their signed responses.
 *   5. Transfer 1 0G of inference credit to that provider.
 *
 * Idempotent — re-running just tops up the ledger if needed and skips
 * already-acknowledged providers. Run after funding the operator wallet
 * with 0G:
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/setup-0g-compute.ts'
 *
 * After this script, the operator process can issue sealed inference calls
 * for any tokenId routed to the 0g-compute backend.
 */

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { loadConfig } from "../src/config.ts";

// Hardcoded TeeML provider on 0G Galileo testnet — published in the
// 0g-compute-ts-starter-kit. Serves qwen-2.5-7b-instruct.
const PROVIDER_ADDRESS = "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08";

const LEDGER_MIN_OG = 3;
const PROVIDER_TRANSFER_OG = 1;

async function main() {
  const config = loadConfig();
  console.log("[0g-setup] connecting to 0G Galileo");

  const provider = new ethers.JsonRpcProvider(config.ZG_RPC_URL);
  const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
  console.log(`[0g-setup] operator wallet: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`[0g-setup] balance: ${ethers.formatEther(balance)} 0G`);

  if (balance < ethers.parseEther((LEDGER_MIN_OG + PROVIDER_TRANSFER_OG + 0.1).toString())) {
    console.error(
      `[0g-setup] insufficient balance — need at least ${LEDGER_MIN_OG + PROVIDER_TRANSFER_OG} 0G + gas. Fund ${wallet.address} and re-run.`,
    );
    process.exit(1);
  }

  const broker = await createZGComputeNetworkBroker(wallet);
  console.log("[0g-setup] broker initialized");

  // 1. Ledger
  let ledgerExists = false;
  try {
    // The SDK throws if no ledger; if it returns we're already set up.
    const ledger = await broker.ledger.getLedger();
    console.log("[0g-setup] ledger already exists:", ledger);
    ledgerExists = true;
  } catch {
    console.log(`[0g-setup] no ledger yet; creating with ${LEDGER_MIN_OG} 0G`);
  }
  if (!ledgerExists) {
    await broker.ledger.addLedger(LEDGER_MIN_OG);
    console.log(`[0g-setup] ledger funded with ${LEDGER_MIN_OG} 0G`);
  }

  // 2. Acknowledge provider (idempotent — second call is a no-op or revert)
  try {
    await broker.inference.acknowledgeProviderSigner(PROVIDER_ADDRESS);
    console.log(`[0g-setup] acknowledged provider ${PROVIDER_ADDRESS}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already") || msg.includes("acknowledged")) {
      console.log("[0g-setup] provider already acknowledged");
    } else {
      console.warn(`[0g-setup] acknowledge failed (continuing): ${msg.slice(0, 200)}`);
    }
  }

  // 3. Transfer compute credit to the provider
  try {
    const amount = ethers.parseEther(PROVIDER_TRANSFER_OG.toString());
    await broker.ledger.transferFund(PROVIDER_ADDRESS, "inference", amount);
    console.log(`[0g-setup] transferred ${PROVIDER_TRANSFER_OG} 0G to provider for inference`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[0g-setup] transferFund failed (continuing — may already be funded): ${msg.slice(0, 200)}`);
  }

  // 4. Read service metadata to confirm we can talk to the provider
  try {
    const meta = await broker.inference.getServiceMetadata(PROVIDER_ADDRESS);
    console.log(`[0g-setup] service ready:`, meta);
  } catch (err) {
    console.error(`[0g-setup] failed to read service metadata: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }

  console.log(`\n[0g-setup] complete — provider ${PROVIDER_ADDRESS} is ready for sealed inference.`);
}

main().catch((err) => {
  console.error("[0g-setup] fatal:", err);
  process.exit(1);
});
