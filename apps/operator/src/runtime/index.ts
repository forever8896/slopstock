/**
 * Runtime selection. AGENT_RUNTIME env picks which adapter to instantiate.
 *
 * Defaults to `hermes` — the stateful runtime. Set `AGENT_RUNTIME=openai-compat`
 * to use the simpler single-shot path (useful for raw-model agents like the
 * MEME demo, and for smoke-testing without the agent loop).
 */

import type { OperatorConfig } from "../config.ts";
import type { AgentRuntime } from "./types.ts";
import { OpenAICompatRuntime } from "./openai-compat.ts";
import { HermesAgentRuntime } from "./hermes.ts";

export function buildAgentRuntime(config: OperatorConfig): AgentRuntime {
  switch (config.AGENT_RUNTIME) {
    case "openai-compat":
      return new OpenAICompatRuntime(config);
    case "hermes":
      return new HermesAgentRuntime(config);
  }
}

export type { AgentRuntime, AgentTaskInput, AgentTaskOutput, Hex } from "./types.ts";
export { RuntimeError } from "./types.ts";
