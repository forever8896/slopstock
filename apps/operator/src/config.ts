/**
 * Environment configuration. Read once at boot — anything that wants to vary at
 * runtime should be a tool argument or contract read, not an env mutation.
 */

import { z } from "zod";

const hex20 = /^0x[a-fA-F0-9]{40}$/;

const envSchema = z.object({
  // Chains
  ZG_RPC_URL: z.string().url().default("https://evmrpc-testnet.0g.ai"),
  // 0G Compute broker is a separate concern — testnet's compute marketplace
  // has only a 7B text provider. Mainnet has DeepSeek V3, GLM-5.1, GPT-5.4-
  // mini, etc. We point our chain reads at testnet (where iNFT + AgentRegistry
  // live) and our compute broker at mainnet (where the good TeeML providers
  // live). One operator key signs both.
  ZG_COMPUTE_RPC_URL: z.string().url().default("https://evmrpc.0g.ai"),
  BASE_RPC_URL: z.string().url().default("https://base-sepolia-rpc.publicnode.com"),
  // Ethereum Sepolia — needed for real ENS resolution (slopstock.eth lives here).
  SEPOLIA_RPC_URL: z.string().url().default("https://ethereum-sepolia-rpc.publicnode.com"),

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

  // Deployer key — used by the permissionless launch flow to deploy
  // ShareToken/RevenueVault/IPOSale on Base Sepolia for newly-minted
  // agents. Optional: if absent, /agents/:tokenId/deploy-finance returns 503.
  DEPLOYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),

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

  // Snapshot encryption backend for stateless-operator mode.
  //   "aes"  — AES-256-GCM encrypted blob stored on Walrus (key held by operator).
  //   "seal" — Mysten Seal threshold-encryption (no single party holds the key).
  SNAPSHOT_ENCRYPTION: z.enum(["aes", "seal"]).default("aes"),

  // When true, the operator writes an ENS TXT record pointing to the latest
  // Walrus snapshot after each hermes turn (mainnet ENS, ENSIP-25 verify).
  // Uses z.string().optional().transform so that the STRING "false" correctly
  // yields boolean false (z.coerce.boolean("false") would give true — a footgun).
  ENS_SNAPSHOT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),

  // Ethereum mainnet RPC for ENS pointer reads/writes.
  L1_RPC: z.string().default(""),

  // Mysten Seal network and package to use.
  SEAL_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  SEAL_PACKAGE_ID: z.string().default(""),
  SEAL_ALLOWLIST_ID: z.string().default(""),
  // Minimum threshold of Seal key-server approvals required to decrypt.
  SEAL_THRESHOLD: z.coerce.number().int().positive().default(2),
  // Base64 or bech32 Sui keypair used to sign Seal allowlist access requests.
  SUI_SEAL_KEYPAIR: z.string().default(""),
  // Optional comma-separated Seal key-server object IDs (overrides baked-in
  // testnet defaults). REQUIRED on mainnet — there are no baked-in mainnet defaults
  // (pick verified servers from the Seal "Verified Key Servers" docs page).
  SEAL_KEY_SERVERS: z.string().default(""),
  // Whether the SealClient cryptographically verifies each key server. Empty = default
  // (true on mainnet, false on testnet); set "true"/"false"/"1"/"0" to override.
  SEAL_VERIFY_KEY_SERVERS: z.string().default(""),

  // ── 1Claw cloud-HSM secrets manager (plan 09 Tier-2) ─────────────────────
  // Credentials for agent tools (e.g. ElevenLabs) live in 1Claw's HSM, fetched
  // at the tool layer via resolveSecret() and NEVER placed in the LLM context,
  // skill markdown, or receipt transcript. `1ck_…` keys are used directly as a
  // Bearer token; `ocv_…` agent keys are exchanged for a short-lived JWT.
  // When unset, resolveSecret() throws a clear "not configured" error and the
  // credentialed tool degrades gracefully (never leaks the secret).
  ONECLAW_API_KEY: z.string().optional(),
  ONECLAW_BASE_URL: z.string().url().default("https://api.1claw.xyz"),
  // The vault holding this operator's agent secrets (paths agents/<tokenId>/<ref>).
  ONECLAW_VAULT_ID: z.string().optional(),
});

export type OperatorConfig = z.infer<typeof envSchema>;
export { envSchema };

export function loadConfig(): OperatorConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[stratum/operator] invalid configuration:");
    console.error(parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}
