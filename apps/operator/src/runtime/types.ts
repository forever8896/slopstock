/**
 * Substrate-agnostic interface every Slopstock-listed agent's runtime must satisfy.
 *
 * The iNFT layer (mint, iTransfer, marketplace, registry) doesn't know what's
 * inside the seal — only that the operator can `load()` an agent's persisted
 * state, `runTask()` against it, and `snapshot()` to compute a fresh bundle
 * hash. As long as a runtime implements these three calls, it can be tokenized.
 *
 * Today we ship two adapters:
 *   - openai-compat:  single-shot LLM call wrapped in this interface.
 *                     No persisted state; bundleHashBefore == bundleHashAfter.
 *                     Good for "raw model" agents.
 *   - hermes:         Hermes-pattern stateful agent — skills/, memory.db, an
 *                     agent loop with tool use, autonomous skill creation.
 *
 * Future: openclaw, ironclaw, custom stacks all implement this same interface.
 */

import type { AgentStep, AgentRuntimeKind } from "@stratum/shared";

export type Hex = `0x${string}`;

export interface AgentTaskInput {
  tokenId: bigint;
  subscriber: Hex;
  input: string;
  paymentReceiptId: string;
}

export interface AgentTaskOutput {
  /** Final textual output the subscriber sees. */
  output: string;
  /** keccak256 hex of input bytes. Receipt-binds the request. */
  inputHash: Hex;
  /** keccak256 hex of output bytes. Receipt-binds the response. */
  outputHash: Hex;

  /** Ordered trace of LLM calls, tool calls, skill loads, memory ops. */
  transcript: AgentStep[];

  /** Hash of the agent's persisted state BEFORE this task ran. */
  bundleHashBefore: Hex;
  /** Hash of the agent's persisted state AFTER this task. */
  bundleHashAfter: Hex;
  /** keccak(bundleHashBefore || bundleHashAfter) — proof of single transition. */
  stateDeltaHash: Hex;

  /** Skill names that were active during the task. */
  skillsLoaded: string[];
  /** Skill names created as a result of this task (auto-generated). */
  skillsCreated: string[];

  /** TEE measurement the iNFT pins. Currently a deterministic placeholder
   *  (real ERC-7857 reads this from a parsed TDX/SGX quote). */
  measurement: Hex;
  /** Base64-encoded TEE quote. Placeholder until 0G Compute wiring. */
  teeQuote: string;
  /** TEE vendor (informational). */
  teeVendor: "intel-tdx" | "amd-sev-snp" | "nvidia-h100" | "nvidia-h200";

  /** Identifier for the LLM that handled the task (e.g. "qwen2.5-coder:1.5b"). */
  model: string;
  /** Operator-side wall-clock timestamp. */
  ts: number;
}

export interface AgentRuntime {
  /** Identifier for this runtime (matches AgentRuntimeKind). */
  readonly kind: AgentRuntimeKind;

  /** Hydrate the agent's state for `tokenId` from persistent storage. Idempotent. */
  load(opts: { tokenId: bigint }): Promise<void>;

  /** Run a single task. Caller has already verified payment + authorization. */
  runTask(req: AgentTaskInput): Promise<AgentTaskOutput>;

  /** Compute the current bundle hash for a tokenId. */
  bundleHash(tokenId: bigint): Promise<Hex>;
}

/** Thrown when the runtime can't reach its compute backend. */
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}
