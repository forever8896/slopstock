/**
 * Canonical schemas — see docs/01-architecture.md §6.
 *
 * Bumping any schemaVersion is a breaking change. Coordinate across all
 * workspaces before merging.
 */

export interface AgentMetadata {
  schemaVersion: "stratum/agent/v1";
  name: string;                  // ENS, e.g. "auditor.stratum.eth"
  ticker: string;                // e.g. "AUDIT"
  description: string;
  modelBase: string;             // e.g. "qwen2.5-coder-32b"
  loraURI?: string;              // 0g://... (encrypted)
  systemPromptURI: string;
  ragCorpusURI?: string;
  executor: {
    kind: "0g-compute-sealed";
    minTeeAttestation: "TDX" | "SEV-SNP" | "H100" | "H200";
    endpointHint: string;
  };
  pricing: {
    perCall: string;             // smallest unit (e.g. "1000000" for 1 USDC)
    asset: string;               // ERC-20 address (USDC.base for v1)
    currency: string;            // human-readable label
  };
  vault: string;                 // RevenueVault address (Base)
  shareToken: string;            // ShareToken address (0G)
  ens: string;                   // mirrors `name`
  createdAt: number;             // unix seconds
  version: number;               // bumps on any field change
}

/**
 * One step the agent took inside the seal during a single task.
 * The transcript is an ordered array of these.
 */
export type AgentStep =
  | { kind: "llm"; model: string; promptTokens?: number; completionTokens?: number; ts: number }
  | { kind: "tool"; tool: string; argsHash: string; resultSummary: string; ts: number }
  | { kind: "skill_load"; skill: string; ts: number }
  | { kind: "skill_create"; skill: string; ts: number }
  | { kind: "memory_read"; query: string; resultCount: number; ts: number }
  | { kind: "memory_write"; key: string; ts: number };

export type AgentRuntimeKind = "openai-compat" | "hermes";

export interface InferenceReceipt {
  schemaVersion: "stratum/receipt/v2";
  tokenId: number;
  subscriber: string;            // 0x…
  callId: string;                // uuidv4
  input: string;                 // keccak256 hex of input
  outputHash: string;            // keccak256 hex of output
  model: string;                 // e.g. "qwen2.5-coder@local"
  teeAttestation: {
    vendor: "intel-tdx" | "amd-sev-snp" | "nvidia-h100" | "nvidia-h200";
    quote: string;               // base64
    measurement: string;         // 0x… (32 bytes) — chain-pinned
  };
  paymentProof: string;          // x402 receipt id

  // ─── Agentic fields (v2) ────────────────────────────────────────────────
  agentRuntime: AgentRuntimeKind;
  /** Hash of the agent's serialized state bundle BEFORE this task ran. */
  bundleHashBefore: string;      // 0x… (32 bytes)
  /** Hash of the agent's serialized state bundle AFTER this task. */
  bundleHashAfter: string;
  /** keccak(bundleHashBefore || bundleHashAfter). Lets a verifier prove the
   *  agent's state evolved exactly once during this call. */
  stateDeltaHash: string;
  /** Skill names that were active during this task (loaded into context). */
  skillsLoaded: string[];
  /** Skill names auto-generated as a side effect of this task. Empty for
   *  stateless runtimes. */
  skillsCreated: string[];
  /** Ordered trace of every action the agent took inside the seal. */
  transcript: AgentStep[];
  // ────────────────────────────────────────────────────────────────────────

  ts: number;                    // unix seconds
  signature: string;             // 0x… signed by operator key
}

export interface RevenueSnapshot {
  snapshotId: number;
  blockNumber: number;
  totalShares: string;
  balance: string;               // smallest unit of payment asset
  holders: Array<{ addr: string; shares: string }>;
}
