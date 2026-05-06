/** One-shot: read mainnet sub-account balance @ deepseek-v3 provider. */
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { loadConfig } from "../src/config.ts";

const PROVIDER = "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0"; // deepseek-chat-v3
const FUNDED = 5; // OG transferred to sub-account at setup

async function main() {
  const c = loadConfig();
  const provider = new ethers.JsonRpcProvider(c.ZG_COMPUTE_RPC_URL);
  const wallet = new ethers.Wallet(c.OPERATOR_PRIVATE_KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  const acct = await broker.inference.getAccount(PROVIDER);
  console.log("[mainnet-burn] provider:", PROVIDER);
  console.log("[mainnet-burn] sub-account:", JSON.stringify(acct, (_k, v) =>
    typeof v === "bigint" ? `${ethers.formatEther(v)} OG` : v, 2));

  // Try to compute used vs remaining
  const balOG = Number(ethers.formatEther((acct as { balance: bigint }).balance ?? 0n));
  const used = FUNDED - balOG;
  console.log(`\n[mainnet-burn] funded: ${FUNDED} OG`);
  console.log(`[mainnet-burn] remaining: ${balOG.toFixed(6)} OG`);
  console.log(`[mainnet-burn] burned: ${used.toFixed(6)} OG`);
  console.log(`[mainnet-burn] @ $0.54/OG: $${(used * 0.54).toFixed(6)} burned`);
}
main().catch((err) => { console.error(err); process.exit(1); });
