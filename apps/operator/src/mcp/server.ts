/**
 * MCP server bootstrap. We export a constructed Server that's ready to bind to
 * a transport — the entrypoint chooses stdio or HTTP based on how we're run
 * (AXL forwards mesh → localhost HTTP for production; stdio is convenient for
 * Claude Desktop testing).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { dispatch, tools, type ToolDeps } from "./tools.ts";

export function buildMcpServer(deps: ToolDeps): Server {
  const server = new Server(
    { name: "stratum-operator", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const result = await dispatch(name, args ?? {}, deps);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
