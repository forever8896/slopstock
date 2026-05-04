/**
 * @stratum/operator — agent operator node entrypoint.
 */

// Earliest possible boot marker — if this doesn't appear in Railway logs,
// the process never even started executing this file (path issue, missing
// dep, etc).
process.stderr.write(`[boot] ${new Date().toISOString()} index.ts loaded · cwd=${process.cwd()} · bun=${process.versions["bun"] ?? "?"} · port=${process.env["PORT"] ?? "?"}\n`);

process.on("uncaughtException", (err) => {
  process.stderr.write(`[boot] uncaughtException: ${err instanceof Error ? err.stack : String(err)}\n`);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[boot] unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
});

// 0G testnet TEE provider endpoints serve over HTTPS with non-public CA
// chains. Relax TLS verification BEFORE any module that does network
// initialization is imported.
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

process.stderr.write(`[boot] importing modules…\n`);
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAgentInfoCache, buildClients } from "./chain/clients.ts";
import { buildReceiptSigner } from "./compute/receipt.ts";
import { loadConfig } from "./config.ts";
import { startHttpServer } from "./http/server.ts";
import { buildMcpServer } from "./mcp/server.ts";
import { buildRuntimeRouter } from "./runtime/index.ts";
import { initRegistry, listDynamicAgents } from "./store/dynamic-registry.ts";
process.stderr.write(`[boot] modules imported.\n`);

async function main() {
  process.stderr.write(`[boot] main() entered\n`);
  const config = loadConfig();
  process.stderr.write(`[boot] config loaded · port=${config.HTTP_PORT}\n`);
  const clients = buildClients(config);
  process.stderr.write(`[boot] clients built\n`);

  console.log("[stratum/operator] starting", {
    operator: clients.account.address,
    defaultRuntime: config.AGENT_RUNTIME,
    runtimeByTokenId: config.RUNTIME_BY_TOKEN_ID,
    compute: `${config.COMPUTE_BASE_URL} (${config.COMPUTE_MODEL})`,
    agentsDataDir: config.AGENTS_DATA_DIR,
    agentNft: config.AGENT_NFT_ADDRESS,
    agentRegistry: config.AGENT_REGISTRY_ADDRESS,
    defaultVault: config.AGENT_VAULT_ADDRESS,
  });

  const agentNftAddress = config.AGENT_NFT_ADDRESS as `0x${string}`;
  const agentRegistryAddress = config.AGENT_REGISTRY_ADDRESS as `0x${string}`;
  const defaultVaultAddress = config.AGENT_VAULT_ADDRESS as `0x${string}`;

  const runtimes = buildRuntimeRouter(config, clients);
  const receiptSigner = buildReceiptSigner(config);
  const agentInfo = buildAgentInfoCache(clients.zgPublic, agentRegistryAddress);

  // Hydrate dynamic registry (agents minted via /launch) from disk so
  // they survive operator restarts. Population happens on first read.
  initRegistry(config.AGENTS_DATA_DIR);
  const dynamicAgents = await listDynamicAgents();
  if (dynamicAgents.length > 0) {
    console.log(
      `[stratum/operator] dynamic registry: ${dynamicAgents.length} permissionless agent(s) live`,
    );
    for (const a of dynamicAgents) {
      console.log(`  · token #${a.tokenId} ${a.ticker} ${a.perCallHuman} (${a.model})`);
    }
  }

  // 1. MCP server (stdio transport for now; AXL bridge HTTP transport TODO).
  const mcpServer = buildMcpServer({
    config,
    clients,
    runtimes,
    receiptSigner,
    agentInfo,
    agentNftAddress,
    agentRegistryAddress,
  });
  const stdioTransport = new StdioServerTransport();

  // 2. HTTP gateway.
  process.stderr.write(`[boot] starting http on :${config.HTTP_PORT}…\n`);
  const httpServer = startHttpServer({
    config,
    clients,
    runtimes,
    receiptSigner,
    agentInfo,
    defaultVaultAddress,
    agentNftAddress,
    agentRegistryAddress,
  });

  console.log(`[stratum/operator] http listening on :${config.HTTP_PORT}`);
  process.stderr.write(`[boot] http listening · ready for /healthz\n`);
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
