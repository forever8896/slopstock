/**
 * Enumerate every TeeML provider currently registered on 0G Compute and
 * probe each one's edge. Prints which providers are actually answering so
 * we can pick a different one if our default's edge is flaking.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/list-0g-providers.ts'
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

  console.log("[probe] listing services…");
  const services = await broker.inference.listService();
  console.log(`[probe] found ${services.length} services`);

  for (const s of services) {
    const provider = (s.provider ?? (s as { providerAddress?: string }).providerAddress) as string | undefined;
    const url = (s.url ?? (s as { endpoint?: string }).endpoint) as string | undefined;
    const model = (s.model ?? (s as { modelName?: string }).modelName) as string | undefined;
    const verifiability = (s as { verifiability?: string }).verifiability;

    console.log(`\n── provider ${provider ?? "?"} ──`);
    console.log(`  url:           ${url ?? "?"}`);
    console.log(`  model:         ${model ?? "?"}`);
    console.log(`  verifiability: ${verifiability ?? "?"}`);

    if (!provider || !url) continue;

    // Try a tiny chat completion. Acknowledge the provider first if we
    // haven't already (idempotent — second call is a no-op).
    try {
      try {
        await broker.inference.acknowledgeProviderSigner(provider as `0x${string}`);
      } catch {
        // already acknowledged or insufficient credit — surface in the call below.
      }

      const meta = await broker.inference.getServiceMetadata(provider as `0x${string}`);
      const headers = await broker.inference.getRequestHeaders(provider as `0x${string}`, "ping");

      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({
        baseURL: (meta.endpoint as string).replace(/\/+$/, ""),
        apiKey: "not-used",
      });

      const t0 = Date.now();
      const completion = await Promise.race([
        client.chat.completions.create(
          {
            model: meta.model as string,
            messages: [{ role: "user", content: "Reply with the word OK." }],
            temperature: 0,
            max_tokens: 10,
          },
          { headers: headers as unknown as Record<string, string> },
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout 15s")), 15_000)),
      ]) as { choices?: Array<{ message?: { content?: string } }>; id?: string };

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const content = completion.choices?.[0]?.message?.content?.slice(0, 80) ?? "(empty)";
      console.log(`  ✓ alive (${elapsed}s)  chatId=${completion.id?.slice(0, 14) ?? "?"}  reply: ${content}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ failed: ${msg.slice(0, 200)}`);
    }
  }
}

main().catch((err) => {
  console.error("[probe] fatal:", err);
  process.exit(1);
});
