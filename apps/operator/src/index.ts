/**
 * @stratum/operator — agent operator node entrypoint.
 *
 * What runs in this process:
 *   1. The MCP server (stratum.agent.{profile,quote,infer,attestation}).
 *   2. The HTTP gateway: x402 payment + chain-driven /profile + /receipts.
 *   3. (Outside this process) the AXL daemon — forwards mesh requests to
 *      localhost:HTTP_PORT and localhost:MCP_PORT.
 *
 * The compute backend is OpenAI-compatible HTTP (Ollama by default; override
 * via COMPUTE_BASE_URL/COMPUTE_API_KEY/COMPUTE_MODEL).
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
  const clients = buildClients(config);

  console.log("[stratum/operator] starting", {
    operator: clients.account.address,
    compute: `${config.COMPUTE_BASE_URL} (${config.COMPUTE_MODEL})`,
    agentNft: config.AGENT_NFT_ADDRESS,
    agentRegistry: config.AGENT_REGISTRY_ADDRESS,
    vault: config.AGENT_VAULT_ADDRESS,
  });

  const compute = buildComputeClient(config);
  const receiptSigner = buildReceiptSigner(config);

  const agentNftAddress = config.AGENT_NFT_ADDRESS as `0x${string}`;
  const agentRegistryAddress = config.AGENT_REGISTRY_ADDRESS as `0x${string}`;
  const vaultAddress = config.AGENT_VAULT_ADDRESS as `0x${string}`;

  // 1. MCP server (stdio transport for now; AXL bridge HTTP transport TODO).
  const mcpServer = buildMcpServer({
    config,
    clients,
    compute,
    receiptSigner,
    agentNftAddress,
    agentRegistryAddress,
  });
  const stdioTransport = new StdioServerTransport();

  // 2. HTTP gateway.
  const httpServer = startHttpServer({
    config,
    clients,
    compute,
    receiptSigner,
    vaultAddress,
    agentNftAddress,
    agentRegistryAddress,
  });

  console.log(`[stratum/operator] http listening on :${config.HTTP_PORT}`);
  console.log(`[stratum/operator] mcp ready on stdio (HTTP transport for AXL pending)`);

  const shutdown = async (signal: string) => {
    console.log(`[stratum/operator] ${signal} received, shutting down`);
    httpServer.stop();
    await mcpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (process.stdin.isTTY) {
    console.log("[stratum/operator] stdin is a TTY; not binding stdio MCP transport");
    await new Promise(() => {}); // long-lived
  } else {
    await mcpServer.connect(stdioTransport);
  }
}

main().catch((err) => {
  console.error("[stratum/operator] fatal:", err);
  process.exit(1);
});
