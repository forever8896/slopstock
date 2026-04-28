/**
 * Per-tokenId runtime routing.
 *
 * One operator process can serve N agents, each on a potentially different
 * runtime. The router holds a Map<tokenId, AgentRuntime> and lazily
 * instantiates runtimes the first time they're requested.
 *
 * Selection rules (highest priority first):
 *   1. RUNTIME_BY_TOKEN_ID env, JSON like {"1":"hermes","2":"openai-compat"}
 *   2. AGENT_RUNTIME env (default fallback)
 *
 * The same OpenAICompatRuntime instance is shared across all openai-compat
 * tokens (it's stateless), but each Hermes-pattern token gets its own
 * HermesAgentRuntime instance because state is per-token.
 */

import type { OperatorConfig } from "../config.ts";
import type { AgentRuntime } from "./types.ts";
import { OpenAICompatRuntime } from "./openai-compat.ts";
import { HermesAgentRuntime } from "./hermes.ts";

export interface RuntimeRouter {
  /** Pick the runtime for a given agent. Cached after first lookup. */
  forToken(tokenId: bigint): AgentRuntime;
  /** All tokenIds this router knows about explicitly (from RUNTIME_BY_TOKEN_ID).
   *  Doesn't include the default-runtime tokens — those are discovered on demand. */
  knownTokens(): bigint[];
}

class DefaultRuntimeRouter implements RuntimeRouter {
  private readonly cache = new Map<string, AgentRuntime>();
  /** Single shared openai-compat runtime — it's stateless. */
  private sharedOpenAICompat: OpenAICompatRuntime;
  private readonly hermesByToken = new Map<string, HermesAgentRuntime>();

  constructor(private readonly config: OperatorConfig) {
    this.sharedOpenAICompat = new OpenAICompatRuntime(config);
  }

  forToken(tokenId: bigint): AgentRuntime {
    const key = tokenId.toString();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const kind = this.config.RUNTIME_BY_TOKEN_ID[key] ?? this.config.AGENT_RUNTIME;
    let rt: AgentRuntime;
    if (kind === "hermes") {
      let h = this.hermesByToken.get(key);
      if (!h) {
        h = new HermesAgentRuntime(this.config);
        this.hermesByToken.set(key, h);
      }
      rt = h;
    } else {
      rt = this.sharedOpenAICompat;
    }
    this.cache.set(key, rt);
    return rt;
  }

  knownTokens(): bigint[] {
    return Object.keys(this.config.RUNTIME_BY_TOKEN_ID).map((k) => BigInt(k));
  }
}

export function buildRuntimeRouter(config: OperatorConfig): RuntimeRouter {
  return new DefaultRuntimeRouter(config);
}

export type { AgentRuntime, AgentTaskInput, AgentTaskOutput, Hex } from "./types.ts";
export { RuntimeError } from "./types.ts";
