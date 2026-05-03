/**
 * Per-tokenId routing for both runtime AND compute backend.
 *
 * Two orthogonal axes:
 *
 *   Runtime  (the layer above the LLM call):
 *     - hermes:        stateful agent loop, tools, skills, memory
 *     - openai-compat: single-shot LLM call wrapped in the AgentRuntime interface
 *
 *   Compute backend (where the LLM call physically goes):
 *     - openai-compat: HTTP to any OpenAI-shaped endpoint (Ollama / OpenRouter / …)
 *     - 0g-compute:    routed through @0glabs/0g-serving-broker for sealed,
 *                      TeeML-verified inference inside an Intel TDX (or H100/H200)
 *                      enclave
 *
 * Selection per tokenId:
 *   1. RUNTIME_BY_TOKEN_ID   env (JSON) → which runtime
 *   2. AGENT_RUNTIME         env       → fallback runtime
 *   3. BACKEND_BY_TOKEN_ID   env (JSON) → which backend
 *   4. COMPUTE_BACKEND       env       → fallback backend
 *
 * The backend is held inside the runtime instance — Hermes runtimes are
 * built per-tokenId (because state is per-token), each with its own
 * (potentially different) backend. OpenAICompat runtimes are cached per-
 * backend (the runtime itself is stateless).
 */

import type { Clients } from "../chain/clients.ts";
import type { OperatorConfig } from "../config.ts";
import type { LLMBackend } from "./llm-backend.ts";
import { OpenAICompatBackend, ZGComputeBackend, getZGBroker } from "./llm-backend.ts";
import type { AgentRuntime } from "./types.ts";
import { OpenAICompatRuntime } from "./openai-compat.ts";
import { HermesAgentRuntime } from "./hermes.ts";

export interface RuntimeRouter {
  forToken(tokenId: bigint): Promise<AgentRuntime>;
  knownTokens(): bigint[];
}

class DefaultRuntimeRouter implements RuntimeRouter {
  private readonly runtimeCache = new Map<string, AgentRuntime>();
  /** Backend instances keyed by their kind. openai-compat is shared (HTTP);
   *  0g-compute is shared (broker singleton). */
  private readonly backendCache = new Map<string, LLMBackend>();

  constructor(
    private readonly config: OperatorConfig,
    private readonly clients?: Clients,
  ) {}

  async forToken(tokenId: bigint): Promise<AgentRuntime> {
    const key = tokenId.toString();

    // Dynamic registry: agents minted via /launch live here. Their
    // runtime+model+systemPrompt come from the in-memory registry and
    // override the static env-driven config. We don't cache these by
    // tokenId because the registry can be updated at runtime — refetch.
    const { getDynamicAgentSync } = await import("./dynamic-cache.ts");
    const dyn = getDynamicAgentSync(tokenId);
    if (dyn) {
      const dynBackend = new OpenAICompatBackend({
        baseUrl: this.config.COMPUTE_BASE_URL,
        apiKey: this.config.COMPUTE_API_KEY,
        model: dyn.model,
      });
      // Always openai-compat for dynamic agents v1 — Hermes-pattern
      // requires seed files, which a browser-only mint can't pin.
      return new OpenAICompatRuntime(dynBackend, {
        systemPromptOverride: dyn.systemPrompt,
      });
    }

    const cached = this.runtimeCache.get(key);
    if (cached) return cached;

    const runtimeKind =
      this.config.RUNTIME_BY_TOKEN_ID[key] ?? this.config.AGENT_RUNTIME;
    const backendKind =
      this.config.BACKEND_BY_TOKEN_ID[key] ?? this.config.COMPUTE_BACKEND;
    const backend = await this.backendFor(backendKind);

    let rt: AgentRuntime;
    if (runtimeKind === "hermes") {
      const h = new HermesAgentRuntime(this.config, backend);
      if (this.clients) h.attachOperatorContext(this.clients);
      rt = h;
    } else {
      // openai-compat runtime is stateless — share by backend kind so we
      // don't construct one per token unnecessarily.
      const sharedKey = `oac:${backendKind}`;
      let r = this.runtimeCache.get(sharedKey);
      if (!r) {
        r = new OpenAICompatRuntime(backend);
        this.runtimeCache.set(sharedKey, r);
      }
      rt = r;
    }
    this.runtimeCache.set(key, rt);
    return rt;
  }

  private async backendFor(kind: "openai-compat" | "0g-compute"): Promise<LLMBackend> {
    const cached = this.backendCache.get(kind);
    if (cached) return cached;
    let backend: LLMBackend;
    if (kind === "0g-compute") {
      const broker = await getZGBroker(this.config);
      backend = new ZGComputeBackend({
        broker,
        providerAddress: this.config.ZG_COMPUTE_PROVIDER_ADDRESS as `0x${string}`,
      });
    } else {
      backend = new OpenAICompatBackend({
        baseUrl: this.config.COMPUTE_BASE_URL,
        apiKey: this.config.COMPUTE_API_KEY,
        model: this.config.COMPUTE_MODEL,
      });
    }
    this.backendCache.set(kind, backend);
    return backend;
  }

  knownTokens(): bigint[] {
    return Object.keys(this.config.RUNTIME_BY_TOKEN_ID).map((k) => BigInt(k));
  }
}

export function buildRuntimeRouter(config: OperatorConfig, clients?: Clients): RuntimeRouter {
  return new DefaultRuntimeRouter(config, clients);
}

export type { AgentRuntime, AgentTaskInput, AgentTaskOutput, Hex } from "./types.ts";
export { RuntimeError } from "./types.ts";
