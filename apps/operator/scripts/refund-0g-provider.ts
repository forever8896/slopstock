/**
 * Move funds out of a provider's locked balance back to the ledger's
 * available pool. Used to reclaim 0G we'd allocated to a provider whose
 * edge isn't responding.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/refund-0g-provider.ts <providerAddress> [amount]'
 */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { loadConfig } from "../src/config.ts";

const PROVIDER = process.argv[2];
const AMOUNT = process.argv[3];

if (!PROVIDER) {
  console.error("usage: refund-0g-provider.ts <providerAddress> [amount]");
  process.exit(2);
}

async function main() {
  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.ZG_RPC_URL);
  const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  // SDK signatures (verified against @0gfoundation/0g-compute-ts-sdk):
  //   ledger.retrieveFundFromProvider(serviceTypeStr, providerAddress, gasPrice?)
  //   ledger.retrieveFund(serviceTypeStr, gasPrice?)   // ALL providers
  // The serviceType is the STRING "inference" (not an array), and the 2nd/3rd
  // positional arg is gasPrice — passing "inference" there throws
  // "Failed to parse String to BigInt".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ledg = broker.ledger as any;
  void AMOUNT; // retrieveFund pulls the full refundable sub-account balance

  if (typeof ledg.retrieveFundFromProvider === "function") {
    console.log(`[refund] ledger.retrieveFundFromProvider("inference", ${PROVIDER})`);
    await ledg.retrieveFundFromProvider("inference", PROVIDER);
    console.log("[refund] done");
    return;
  }
  if (typeof ledg.retrieveFund === "function") {
    console.log('[refund] ledger.retrieveFund("inference") — all providers');
    await ledg.retrieveFund("inference");
    console.log("[refund] done");
    return;
  }

  console.error("[refund] no retrieveFund method on broker.ledger; available:");
  console.error("  ledger:", Object.keys(ledg));
  process.exit(3);
}

main().catch((err) => {
  console.error("[refund] fatal:", err);
  process.exit(1);
});
