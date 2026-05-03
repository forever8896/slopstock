/**
 * Direct invocation of the query_agent tool — proves the agent-to-agent
 * x402 path works end-to-end with a real onchain USDC payment, without
 * relying on a small local model to autonomously pick the tool.
 *
 * Run with the operator's env loaded AND a separate operator process
 * running on :8402 (so the peer call has a target):
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-agent-to-agent.ts'
 *
 * Expected sequence on chain:
 *   1. Tool fetches the ORCL challenge from /x402/infer (vault + price).
 *   2. AUDIT's wallet (0xc1Cba…BF83) sends USDC.transfer(orclVault, 0.10)
 *      to ORCL's vault (0xE8e3…C734).
 *   3. We submit the txHash back to /x402/infer with the receipt header.
 *   4. The peer operator chain-validates, runs ORCL's task, returns the
 *      price-source assessment.
 *   5. We print the response.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClients } from "../src/chain/clients.ts";
import { loadConfig } from "../src/config.ts";
import { TOOL_REGISTRY, type ToolCtx } from "../src/runtime/hermes-tools.ts";

async function main() {
  const config = loadConfig();
  const clients = buildClients(config);

  // Throwaway in-memory db; the query_agent tool only needs db for recall/note.
  const tmp = mkdtempSync(join(tmpdir(), "stratum-smoke-"));
  const db = new Database(join(tmp, "memory.db"), { create: true });

  const ctx: ToolCtx = {
    input: "(direct invocation)",
    agentDir: tmp,
    db,
    callId: crypto.randomUUID(),
    callerTokenId: 1n, // AUDIT
    subscriber: "0x0000000000000000000000000000000000000000",
    clients,
    config,
    peerOperatorUrl: `http://127.0.0.1:${config.HTTP_PORT}`,
  };

  console.log("[a2a] AUDIT → ORCL via query_agent");
  console.log(`[a2a] caller wallet (deterministic): see print-agent-wallets.ts`);
  console.log(`[a2a] target: oracles.slopstock.eth (ORCL)`);
  console.log(`[a2a] peer operator: ${ctx.peerOperatorUrl}`);
  console.log(`[a2a] dispatching…`);

  const tool = TOOL_REGISTRY["query_agent"];
  if (!tool) throw new Error("query_agent not registered");

  const t0 = Date.now();
  const result = await tool.handler(
    {
      agent: "oracles.slopstock.eth",
      input: "WETH/USDC spot vs TWAP — is the Uniswap v2 pool deep enough that spot use is safe in a flash-loan-aware system?",
    },
    ctx,
  );
  const elapsed = Date.now() - t0;

  console.log(`\n[a2a] elapsed: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`[a2a] resultSummary: ${result.resultSummary}`);
  console.log(`[a2a] meta: ${JSON.stringify(result.meta, null, 2)}`);
  console.log(`\n[a2a] === ORCL response ===`);
  console.log(result.text);
}

main().catch((err) => {
  console.error("[a2a] fatal:", err);
  process.exit(1);
});
