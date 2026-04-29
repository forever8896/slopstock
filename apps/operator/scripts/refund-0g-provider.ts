/**
 * Move funds out of a provider's locked balance back to the ledger's
 * available pool. Used to reclaim 0G we'd allocated to a provider whose
 * edge isn't responding.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/refund-0g-provider.ts <providerAddress> [amount]'
 */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
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

  // Try the broker's documented retrieveFund first.
  // (Different SDK versions name this differently; we try a few.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inf = broker.inference as any;
  const ledg = broker.ledger as any;

  // Method 1: inference.retrieveFund
  if (typeof inf.retrieveFund === "function") {
    console.log("[refund] using inference.retrieveFund");
    const arg = AMOUNT ? ethers.parseEther(AMOUNT) : undefined;
    await inf.retrieveFund(PROVIDER, "inference", arg);
    console.log("[refund] done");
    return;
  }
  // Method 2: ledger.retrieveFund (with serviceType)
  if (typeof ledg.retrieveFund === "function") {
    console.log("[refund] using ledger.retrieveFund");
    await ledg.retrieveFund([PROVIDER], "inference");
    console.log("[refund] done");
    return;
  }

  console.error("[refund] no retrieveFund method on broker; available:");
  console.error("  inference:", Object.keys(inf));
  console.error("  ledger:   ", Object.keys(ledg));
  process.exit(3);
}

main().catch((err) => {
  console.error("[refund] fatal:", err);
  process.exit(1);
});
