/**
 * Deposit OG into the operator's 0G compute ledger, then open/fund a provider
 * sub-account for inference. Runs against 0G MAINNET (ZG_COMPUTE_RPC_URL).
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/fund-0g-subaccount.ts <provider> [depositOG=4] [transferOG=2]'
 *
 * Sub-account creation requires a >= 1 OG transfer (contract MIN_TRANSFER_AMOUNT).
 */

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { loadConfig } from "../src/config.ts";

const PROVIDER = process.argv[2];
const DEPOSIT_OG = Number(process.argv[3] ?? "4");
const TRANSFER_OG = process.argv[4] ?? "2";

if (!PROVIDER) { console.error("usage: fund-0g-subaccount.ts <provider> [depositOG] [transferOG]"); process.exit(2); }

async function main() {
  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.ZG_COMPUTE_RPC_URL);
  const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
  console.log(`[fund] mainnet ${config.ZG_COMPUTE_RPC_URL} | operator ${wallet.address}`);
  console.log(`[fund] native OG: ${ethers.formatEther(await provider.getBalance(wallet.address))}`);

  const broker = await createZGComputeNetworkBroker(wallet);

  console.log(`[fund] depositFund(${DEPOSIT_OG} OG) into ledger…`);
  await broker.ledger.depositFund(DEPOSIT_OG);
  console.log(`[fund] deposited. ledger:`, await broker.ledger.getLedger().catch(() => "(read failed)"));

  try {
    await broker.inference.acknowledgeProviderSigner(PROVIDER);
    console.log(`[fund] acknowledged provider ${PROVIDER}`);
  } catch (e) {
    const m = (e as Error).message;
    console.log(m.includes("already") || m.includes("acknowledged") ? "[fund] provider already acknowledged" : `[fund] ack warn: ${m.slice(0, 160)}`);
  }

  console.log(`[fund] transferFund(${TRANSFER_OG} OG) → ${PROVIDER}…`);
  await broker.ledger.transferFund(PROVIDER, "inference", ethers.parseEther(TRANSFER_OG));
  console.log(`[fund] sub-account funded.`);

  const meta = await broker.inference.getServiceMetadata(PROVIDER);
  console.log(`[fund] service ready: model=${meta.model} endpoint=${meta.endpoint}`);
  const acct = await (broker.inference as any).getAccount(PROVIDER);
  console.log(`[fund] sub-account balance (raw): ${acct?.[3]?.toString?.() ?? acct?.balance ?? "?"}`);
  console.log(`\n[fund] done — set ZG_COMPUTE_PROVIDER_ADDRESS=${PROVIDER}`);
}

main().catch((e) => { console.error("[fund] fatal:", e?.message ?? e); process.exit(1); });
