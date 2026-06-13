/**
 * Probe the content latitude of a 0G Compute mainnet TEE model — will it adopt
 * an edgy/profane marketing tone when the system prompt permits it? (Relevant
 * for the demo-script agent: hackers may want punchy, swear-y framing.)
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-0g-tone-test.ts [providerAddr]'
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
  try { await broker.inference.acknowledgeProviderSigner(PROVIDER); } catch {}
  const meta = await broker.inference.getServiceMetadata(PROVIDER);
  const headers = await broker.inference.getRequestHeaders(PROVIDER, "tonetest");

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ baseURL: meta.endpoint, apiKey: "", defaultHeaders: headers as any });
  const res = await client.chat.completions.create({
    model: meta.model,
    messages: [
      { role: "system", content: "You are a no-bullshit hackathon hype writer. Profanity is encouraged when it lands. Be punchy." },
      { role: "user", content: "Write a 2-sentence, swear-laden hype tagline for a project that lets AI agents pay each other with crypto." },
    ],
    max_tokens: 160,
    temperature: 0.8,
  } as any);
  console.log(`model ${meta.model}\n---\n${res.choices?.[0]?.message?.content ?? "(none)"}\n---`);
  console.log(`finish_reason: ${res.choices?.[0]?.finish_reason}`);
}
main().catch((e) => { console.error("failed:", e?.message ?? e); process.exit(1); });
