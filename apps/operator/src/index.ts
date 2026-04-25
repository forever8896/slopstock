/**
 * @stratum/operator — agent operator node entrypoint.
 *
 * Spec: docs/03-sealed-inference.md §9 and docs/06-axl-delivery.md §4-5.
 *
 * What runs in this process:
 *   1. The MCP server (stratum.agent.{profile,quote,infer,attestation}).
 *   2. The HTTP x402 gateway (POST /x402/infer, GET /healthz).
 *   3. (Outside this process) the AXL daemon — forwards mesh requests to
 *      localhost:HTTP_PORT and localhost:MCP_PORT.
 *
 * In demo mode the 0G Compute call is short-circuited so the rest of the
 * pipeline is exercisable without 0G testnet access. Set DEMO_MODE=false to
 * route through the real Sealed Executor.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildClients } from "./chain/clients.ts";
import { buildComputeClient } from "./compute/client.ts";
import { buildReceiptSigner } from "./compute/receipt.ts";
import { loadConfig } from "./config.ts";
import { startHttpServer } from "./http/server.ts";
import { buildMcpServer } from "./mcp/server.ts";

async function main() {
  const config = loadConfig();
  console.log("[stratum/operator] starting", { demoMode: config.DEMO_MODE });

  const clients = buildClients(config);
  const compute = buildComputeClient(config);
  const receiptSigner = buildReceiptSigner(config);

  // Vault address is per-agent; in real deployment we look it up from
  // AgentRegistry. For the demo single-agent setup, hard-code a placeholder
  // and let `mint-hero-agent.sh` overwrite it via env.
  const vaultAddress: `0x${string}` =
    (process.env["AGENT_VAULT_ADDRESS"] as `0x${string}` | undefined) ??
    "0x0000000000000000000000000000000000000000";
  const agentNftAddress = process.env["AGENT_NFT_ADDRESS"] as `0x${string}` | undefined;

  // 1. MCP server
  const mcpServer = buildMcpServer({
    config,
    clients,
    compute,
    receiptSigner,
    agentNftAddress,
  });

  // For now we bind MCP to stdio. Once AXL bridge wiring is finalized we'll
  // additionally bind an HTTP/SSE transport to MCP_PORT so AXL's `/mcp/*`
  // proxy can forward mesh requests in.
  const stdioTransport = new StdioServerTransport();

  // 2. x402 HTTP gateway
  const httpServer = startHttpServer({
    config,
    clients,
    compute,
    receiptSigner,
    vaultAddress,
  });

  console.log(`[stratum/operator] http listening on :${config.HTTP_PORT}`);
  console.log(`[stratum/operator] mcp listening on stdio (will add HTTP transport for AXL)`);

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    console.log(`[stratum/operator] ${signal} received, shutting down`);
    httpServer.stop();
    await mcpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // If stdin is a TTY, run as a long-lived service without binding stdio MCP
  // (otherwise the server would try to read JSON-RPC frames from your terminal).
  if (process.stdin.isTTY) {
    console.log("[stratum/operator] stdin is a TTY; not binding stdio MCP transport");
    await new Promise(() => {}); // keep the process alive
  } else {
    await mcpServer.connect(stdioTransport);
  }
}

main().catch((err) => {
  console.error("[stratum/operator] fatal:", err);
  process.exit(1);
});
