/**
 * Environment configuration. Read once at boot — anything that wants to vary at
 * runtime should be a tool argument or contract read, not an env mutation.
 */

import { z } from "zod";

const envSchema = z.object({
  // Chains
  ZG_RPC_URL: z.string().url().default("https://evmrpc-testnet.0g.ai"),
  BASE_RPC_URL: z.string().url().default("https://sepolia.base.org"),

  // 0G Compute (Sealed Executor)
  ZG_COMPUTE_PROXY_URL: z.string().url().default("https://compute.0g.ai/v1/proxy"),
  ZG_COMPUTE_API_KEY: z.string().optional(),

  // 0G Storage
  ZG_STORAGE_INDEXER_URL: z.string().url().default("https://indexer-storage-testnet-turbo.0g.ai"),

  // x402
  X402_FACILITATOR_URL: z.string().url().default("https://x402.coinbase.com"),

  // Local ports
  HTTP_PORT: z.coerce.number().int().default(8402),
  MCP_PORT: z.coerce.number().int().default(9050),
  AXL_BRIDGE_URL: z.string().url().default("http://127.0.0.1:9001"),

  // Operator identity (for signing receipts; chain interactions use a wallet config later)
  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),

  // Demo mode — short-circuits 0G Compute with deterministic fake outputs
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type OperatorConfig = z.infer<typeof envSchema>;

export function loadConfig(): OperatorConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[stratum/operator] invalid configuration:");
    console.error(parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}
