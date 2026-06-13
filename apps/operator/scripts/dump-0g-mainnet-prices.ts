/** Read-only: dump per-token pricing for 0G Compute mainnet services. */
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://evmrpc.0g.ai");
  const wallet = new ethers.Wallet(process.env["OPERATOR_PRIVATE_KEY"]!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  const services = await broker.inference.listService();
  for (const s of services) {
    const model = (s.model ?? (s as any).modelName) as string;
    if (!/deepseek|glm-5|qwen3.7|gpt-5/i.test(model)) continue;
    console.log(`\n=== ${model} ===`);
    console.log(JSON.stringify(s, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
