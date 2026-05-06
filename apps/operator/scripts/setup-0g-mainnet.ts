/**
 * One-shot 0G Compute broker setup for the operator AGAINST 0G MAINNET.
 *
 * Mainnet (chainId 16661) has serious TeeML providers — DeepSeek V3, GLM-5.1,
 * GPT-5.4-mini — that don't exist on testnet. This script funds an inference
 * sub-account at the chosen provider so the operator can route any agent's
 * 0g-compute backend to mainnet TEE-attested inference.
 *
 * Independent of setup-0g-compute.ts (which targets testnet). Iniate after
 * the operator's mainnet wallet is funded with 0G.
 *
 * Usage:
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/setup-0g-mainnet.ts'
 */

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { loadConfig } from "../src/config.ts";

// DeepSeek V3 under TeeML on 0G mainnet. Top-tier reasoning, faithfully
// copies fetched values into JSON, recommended deposit is small (7.292 OG).
const PROVIDER_ADDRESS = "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0";

const LEDGER_OG = 6.5;            // Ledger funding (one-time)
const PROVIDER_TRANSFER_OG = 5;   // Sub-account transfer (used for inference)

async function main() {
  const config = loadConfig();
  console.log(`[0g-mainnet] connecting to 0G mainnet at ${config.ZG_COMPUTE_RPC_URL}`);

  const provider = new ethers.JsonRpcProvider(config.ZG_COMPUTE_RPC_URL);
  const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
  console.log(`[0g-mainnet] operator wallet: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`[0g-mainnet] mainnet balance: ${ethers.formatEther(balance)} OG`);

  if (balance < ethers.parseEther((LEDGER_OG + 0.1).toString())) {
    console.error(
      `[0g-mainnet] insufficient mainnet balance — need at least ${LEDGER_OG + 0.1} OG. Fund ${wallet.address} on 0G mainnet and re-run.`,
    );
    process.exit(1);
  }

  const broker = await createZGComputeNetworkBroker(wallet);
  console.log("[0g-mainnet] broker initialized against mainnet");

  // 1. Ledger
  let ledgerExists = false;
  try {
    const ledger = await broker.ledger.getLedger();
    console.log("[0g-mainnet] ledger already exists:", ledger);
    ledgerExists = true;
  } catch {
    console.log(`[0g-mainnet] no ledger yet; creating with ${LEDGER_OG} OG`);
  }
  if (!ledgerExists) {
    await broker.ledger.addLedger(LEDGER_OG);
    console.log(`[0g-mainnet] ledger funded with ${LEDGER_OG} OG`);
  }

  // 2. Acknowledge provider (idempotent)
  try {
    await broker.inference.acknowledgeProviderSigner(PROVIDER_ADDRESS);
    console.log(`[0g-mainnet] acknowledged provider ${PROVIDER_ADDRESS}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already") || msg.includes("acknowledged")) {
      console.log("[0g-mainnet] provider already acknowledged");
    } else {
      console.warn(`[0g-mainnet] acknowledge failed (continuing): ${msg.slice(0, 200)}`);
    }
  }

  // 3. Transfer to provider sub-account
  try {
    const amount = ethers.parseEther(PROVIDER_TRANSFER_OG.toString());
    await broker.ledger.transferFund(PROVIDER_ADDRESS, "inference", amount);
    console.log(`[0g-mainnet] transferred ${PROVIDER_TRANSFER_OG} OG to provider for inference`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[0g-mainnet] transferFund failed (continuing — may already be funded): ${msg.slice(0, 200)}`);
  }

  // 4. Read service metadata
  try {
    const meta = await broker.inference.getServiceMetadata(PROVIDER_ADDRESS);
    console.log(`[0g-mainnet] service ready:`, meta);
  } catch (err) {
    console.error(`[0g-mainnet] failed to read service metadata: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }

  console.log(`\n[0g-mainnet] complete — provider ${PROVIDER_ADDRESS} ready for sealed inference.`);
  console.log(`[0g-mainnet] set ZG_COMPUTE_PROVIDER_ADDRESS=${PROVIDER_ADDRESS} on the operator.`);
}

main().catch((err) => {
  console.error("[0g-mainnet] fatal:", err);
  process.exit(1);
});
