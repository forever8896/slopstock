/**
 * READ-ONLY: inspect the operator's 0G Compute MAINNET ledger and every
 * provider sub-account that holds a balance. No transactions sent.
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/inspect-0g-mainnet-ledger.ts'
 */
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const MAINNET_RPC = "https://evmrpc.0g.ai";
const fmt = (v: unknown) => (typeof v === "bigint" ? `${ethers.formatEther(v)} 0G` : v);

async function main() {
  const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
  const net = await provider.getNetwork();
  const wallet = new ethers.Wallet(process.env["OPERATOR_PRIVATE_KEY"]!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log(`chain: ${net.chainId} | operator: ${wallet.address}`);
  console.log(`gas balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} 0G`);

  const ledger = await broker.ledger.getLedger();
  console.log("ledger:", JSON.stringify(ledger, (_, v) => fmt(v)));

  const services = await broker.inference.listService();
  console.log(`\nenumerating ${services.length} providers for held balances:\n`);
  const inf = broker.inference as any;
  for (const s of services) {
    const p = (s.provider ?? (s as any).providerAddress) as string;
    const model = (s.model ?? (s as any).modelName) as string;
    try {
      const acct = await inf.getAccount(p as `0x${string}`);
      // acct fields vary by SDK; print balance-bearing ones only
      const bal = (acct?.balance ?? acct?.[2]);
      const pending = (acct?.pendingRefund ?? acct?.[4]);
      if (bal && bal.toString() !== "0") {
        console.log(`HELD  ${model.padEnd(30)} ${p}  balance=${fmt(bal)} pendingRefund=${fmt(pending)}`);
      }
    } catch {
      /* no sub-account for this provider — skip */
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
