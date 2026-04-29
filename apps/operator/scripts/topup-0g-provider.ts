/**
 * Transfer N 0G from the operator's broker ledger to a specific provider's
 * inference balance. Used to top up after the probe script's "ping" call
 * consumed our initial credit.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/topup-0g-provider.ts <amount>'
 */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { loadConfig } from "../src/config.ts";

const AMOUNT = process.argv[2] ?? "1.5";

async function main() {
  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.ZG_RPC_URL);
  const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  const target = config.ZG_COMPUTE_PROVIDER_ADDRESS as `0x${string}`;
  console.log(`[topup] target provider: ${target}`);
  console.log(`[topup] amount: ${AMOUNT} 0G`);

  const amountWei = ethers.parseEther(AMOUNT);
  await broker.ledger.transferFund(target, "inference", amountWei);
  console.log(`[topup] done. Run apps/operator/scripts/smoke-agent-to-agent.ts to test.`);
}

main().catch((err) => {
  console.error("[topup] fatal:", err);
  process.exit(1);
});
