/**
 * Inspect the operator's 0G Compute ledger + per-provider balances.
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/check-0g-ledger.ts'
 */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { loadConfig } from "../src/config.ts";

async function main() {
  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.ZG_RPC_URL);
  const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log("[ledger] operator:", wallet.address);
  console.log("[ledger] 0G balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "0G");

  try {
    const ledger = await broker.ledger.getLedger();
    console.log("[ledger] ledger:", JSON.stringify(ledger, (_, v) =>
      typeof v === "bigint" ? `${ethers.formatEther(v)} 0G (${v.toString()})` : v, 2));
  } catch (err) {
    console.log("[ledger] no ledger:", err instanceof Error ? err.message : err);
  }

  // Check provider balances explicitly.
  const providers = [
    "0xa48f01287233509FD694a22Bf840225062E67836",
    "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08",
  ];
  for (const p of providers) {
    try {
      const account = await broker.inference.getAccount(p as `0x${string}`);
      console.log(`[ledger] provider ${p}:`, JSON.stringify(account, (_, v) =>
        typeof v === "bigint" ? `${ethers.formatEther(v)} 0G` : v, 2));
    } catch (err) {
      console.log(`[ledger] provider ${p}: no account / err`);
    }
  }
}

main().catch((err) => {
  console.error("[ledger] fatal:", err);
  process.exit(1);
});
