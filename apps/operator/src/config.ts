/**
 * Environment configuration. Read once at boot — anything that wants to vary at
 * runtime should be a tool argument or contract read, not an env mutation.
 */

import { z } from "zod";

const hex20 = /^0x[a-fA-F0-9]{40}$/;

const envSchema = z.object({
  // Chains
  ZG_RPC_URL: z.string().url().default("https://evmrpc-testnet.0g.ai"),
  BASE_RPC_URL: z.string().url().default("https://base-sepolia-rpc.publicnode.com"),

  // Compute backend (OpenAI-compatible HTTP). Defaults target a local Ollama
  // server on the operator's host. Override with COMPUTE_BASE_URL +
  // COMPUTE_API_KEY for any provider that speaks the OpenAI Chat Completions
  // shape (Together AI, vLLM, OpenRouter, etc.).
  COMPUTE_BASE_URL: z.string().url().default("http://127.0.0.1:11434/v1"),
  COMPUTE_API_KEY: z.string().optional(),
  COMPUTE_MODEL: z.string().default("qwen2.5-coder:7b"),

  // x402 — we self-validate on chain (no facilitator dependency).
  X402_USDC_ADDRESS: z
    .string()
    .regex(hex20)
    .default("0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
  // Min confirmations on Base Sepolia before a payment receipt is accepted.
  X402_MIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(0),

  // Local ports
  HTTP_PORT: z.coerce.number().int().default(8402),
  MCP_PORT: z.coerce.number().int().default(9050),
  AXL_BRIDGE_URL: z.string().url().default("http://127.0.0.1:9001"),

  // Operator identity. Required for receipt signing.
  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/),

  // Stratum on-chain singletons (0G Galileo). Required so the operator can
  // resolve agent profiles, the per-agent vault address, and the iNFT
  // measurement.
  AGENT_NFT_ADDRESS: z.string().regex(hex20),
  AGENT_REGISTRY_ADDRESS: z.string().regex(hex20),

  // Per-agent: the vault for x402 payments. We could read it from
  // AgentRegistry per-tokenId, but x402 challenges happen before we know
  // which token is being inferred against, so the operator needs a default
  // vault for its primary agent. Single-agent operators set this at boot.
  AGENT_VAULT_ADDRESS: z.string().regex(hex20),

  // Receipt persistence.
  RECEIPTS_DB_PATH: z.string().default("./data/receipts.db"),
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
