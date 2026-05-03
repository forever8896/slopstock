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

  // Default agent runtime kind for tokenIds that aren't in RUNTIME_BY_TOKEN_ID.
  // `hermes` = stateful skill-accumulating agent; `openai-compat` = single-shot.
  AGENT_RUNTIME: z.enum(["hermes", "openai-compat"]).default("openai-compat"),

  // Per-tokenId runtime override. JSON: {"1":"hermes","2":"openai-compat","3":"openai-compat"}
  // Lets one operator process serve N agents on different runtimes — the
  // protocol layer is substrate-agnostic.
  RUNTIME_BY_TOKEN_ID: z
    .string()
    .default("{}")
    .transform((s) => {
      try {
        return JSON.parse(s) as Record<string, "hermes" | "openai-compat">;
      } catch {
        return {};
      }
    }),

  // Per-agent state directory. HermesAgentRuntime stores skills + memory
  // under <AGENTS_DATA_DIR>/<tokenId>/.
  AGENTS_DATA_DIR: z.string().default("./data/agents"),

  // Default LLM backend for tokenIds without a BACKEND_BY_TOKEN_ID entry.
  //   "openai-compat" — talk to any OpenAI-shaped Chat Completions endpoint
  //                     (Ollama, OpenRouter, Together, etc).
  //   "0g-compute"    — route through the 0G Compute Network broker for
  //                     TeeML-verified sealed inference.
  COMPUTE_BACKEND: z.enum(["openai-compat", "0g-compute"]).default("openai-compat"),

  // Per-tokenId backend override. JSON: {"3":"0g-compute","1":"openai-compat"}.
  BACKEND_BY_TOKEN_ID: z
    .string()
    .default("{}")
    .transform((s) => {
      try {
        return JSON.parse(s) as Record<string, "openai-compat" | "0g-compute">;
      } catch {
        return {};
      }
    }),

  // OpenAI-compat backend config (used for tokens routed there). Defaults
  // to a local Ollama server.
  COMPUTE_BASE_URL: z.string().url().default("http://127.0.0.1:11434/v1"),
  COMPUTE_API_KEY: z.string().optional(),
  COMPUTE_MODEL: z.string().default("qwen2.5-coder:7b"),

  // 0G Compute provider (TeeML-verified). Set after running
  // setup-0g-compute.ts. Defaults to the testnet provider published in
  // 0g-compute-ts-starter-kit (currently serves google/gemma-3-27b-it).
  ZG_COMPUTE_PROVIDER_ADDRESS: z
    .string()
    .regex(hex20)
    .default("0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08"),

  // x402 — we self-validate on chain (no facilitator dependency).
  X402_USDC_ADDRESS: z
    .string()
    .regex(hex20)
    .default("0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
  // Min confirmations on Base Sepolia before a payment receipt is accepted.
  X402_MIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(0),

  // Local ports. Railway/Render/Fly inject $PORT — fall back to that if
  // HTTP_PORT isn't explicitly set, otherwise default to 8402 for local dev.
  HTTP_PORT: z.coerce.number().int().default(
    process.env["PORT"] ? Number(process.env["PORT"]) : 8402,
  ),
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

  // Default vault for x402 payments when the request omits tokenId. With
  // tokenId in the request body the operator looks up the vault on chain
  // (cached) so this is mostly a fallback for legacy single-agent setups.
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
