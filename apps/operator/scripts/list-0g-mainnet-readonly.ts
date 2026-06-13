/** Read-only: list 0G Compute services on MAINNET. No acks, no probes, no txs. */
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

async function main() {
  const rpc = "https://evmrpc.0g.ai";
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(process.env["OPERATOR_PRIVATE_KEY"]!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  const services = await broker.inference.listService();
  console.log(`mainnet services: ${services.length}`);
  for (const s of services) {
    const p = (s.provider ?? (s as any).providerAddress) as string;
    const model = (s.model ?? (s as any).modelName) as string;
    const v = (s as any).verifiability;
    const url = (s.url ?? (s as any).endpoint) as string;
    console.log(`${model}  | ${v ?? "-"} | ${p} | ${url}`);
  }

  // Also check if the operator has a mainnet ledger + gas balance (read-only)
  const bal = await provider.getBalance(wallet.address);
  console.log(`\noperator mainnet 0G balance: ${ethers.formatEther(bal)}`);
  try {
    const ledger = await broker.ledger.getLedger();
    console.log(`mainnet ledger:`, JSON.stringify(ledger, (_, x) => (typeof x === "bigint" ? ethers.formatEther(x) + " 0G" : x)));
  } catch (e) {
    console.log(`mainnet ledger: none (${(e as Error).message.slice(0, 80)})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
// appended: full pricing dump (read-only)
