/**
 * Smoke one real inference against a 0G Compute MAINNET deepseek provider and
 * report the ledger cost delta. Spends a tiny amount of OG from the provider
 * sub-account. Pass provider address as argv[2] (default: deepseek-v3-0324).
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-0g-mainnet-deepseek.ts [provider]'
 */
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const MAINNET_RPC = "https://evmrpc.0g.ai";
const PROVIDER = (process.argv[2] ?? "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0") as `0x${string}`;

async function main() {
  const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
  const wallet = new ethers.Wallet(process.env["OPERATOR_PRIVATE_KEY"]!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  const inf = broker.inference as any;

  const before = await inf.getAccount(PROVIDER);
  const balBefore = before?.balance ?? before?.[2];

  try { await broker.inference.acknowledgeProviderSigner(PROVIDER); } catch { /* already acked */ }
  const meta = await broker.inference.getServiceMetadata(PROVIDER);
  const headers = await broker.inference.getRequestHeaders(PROVIDER, "ping");

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ baseURL: meta.endpoint, apiKey: "", defaultHeaders: headers as any });
  const t0 = Date.now();
  const res = await client.chat.completions.create({
    model: meta.model,
    messages: [{ role: "user", content: "Reply with exactly: AUDIT-OK" }],
    max_tokens: 16,
  } as any);
  const dt = Date.now() - t0;
  const reply = res.choices?.[0]?.message?.content ?? "(none)";
  console.log(`provider ${PROVIDER}\nmodel ${meta.model}\nlatency ${dt}ms\nreply: ${reply.slice(0, 80)}`);

  const after = await inf.getAccount(PROVIDER);
  const balAfter = after?.balance ?? after?.[2];
  if (balBefore && balAfter) {
    const cost = BigInt(balBefore.toString()) - BigInt(balAfter.toString());
    console.log(`cost this call: ${ethers.formatEther(cost)} OG  | remaining: ${ethers.formatEther(balAfter)} OG`);
  }
}
main().catch((e) => { console.error("smoke failed:", e?.message ?? e); process.exit(1); });
