/**
 * Test whether a 0G Compute mainnet TEE provider supports OpenAI-style tool
 * calling (function calling). Sends a `tools` array + a prompt that should
 * force a tool call, and inspects the response for tool_calls.
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-0g-tool-calling.ts [providerAddr]'
 */
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const MAINNET_RPC = "https://evmrpc.0g.ai";
// default: deepseek-v3-0324 (funded sub-account). v4-pro = 0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB
const PROVIDER = (process.argv[2] ?? "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0") as `0x${string}`;

async function main() {
  const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
  const wallet = new ethers.Wallet(process.env["OPERATOR_PRIVATE_KEY"]!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  try { await broker.inference.acknowledgeProviderSigner(PROVIDER); } catch { /* acked */ }
  const meta = await broker.inference.getServiceMetadata(PROVIDER);
  const headers = await broker.inference.getRequestHeaders(PROVIDER, "tooltest");

  const tools = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file from the repo by path.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "repo-relative file path" } },
          required: ["path"],
        },
      },
    },
  ];

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ baseURL: meta.endpoint, apiKey: "", defaultHeaders: headers as any });
  const res = await client.chat.completions.create({
    model: meta.model,
    messages: [
      { role: "system", content: "You are a repo analyst. When you need a file's contents, call the read_file tool. Do not guess." },
      { role: "user", content: "I need to know what the project's README says. Get it." },
    ],
    tools: tools as any,
    tool_choice: "auto" as any,
    max_tokens: 256,
  } as any);

  const msg = res.choices?.[0]?.message;
  const toolCalls = msg?.tool_calls;
  console.log(`provider ${PROVIDER}\nmodel ${meta.model}`);
  if (toolCalls && toolCalls.length > 0) {
    console.log(`✅ TOOL CALLING SUPPORTED — emitted ${toolCalls.length} tool_call(s):`);
    for (const tc of toolCalls) console.log(`   ${tc.function?.name}(${tc.function?.arguments})`);
  } else {
    console.log(`⚠️ no tool_calls. content: ${(msg?.content ?? "").slice(0, 200)}`);
    console.log(`finish_reason: ${res.choices?.[0]?.finish_reason}`);
  }
}
main().catch((e) => { console.error("smoke failed:", e?.message ?? e); process.exit(1); });
