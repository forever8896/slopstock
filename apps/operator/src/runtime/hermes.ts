/**
 * HermesAgentRuntime — stateful, skill-accumulating agent following the
 * Hermes Agent pattern (Nous Research, agentskills.io-compatible skill
 * format, three-layer memory, autonomous skill creation).
 *
 * Implementation lands in tasks #34–#38. This file is the placeholder so
 * runtime/index.ts can branch on AGENT_RUNTIME=hermes from the start.
 */

import type { OperatorConfig } from "../config.ts";
import { RuntimeError, type AgentRuntime, type AgentTaskInput, type AgentTaskOutput, type Hex } from "./types.ts";

export class HermesAgentRuntime implements AgentRuntime {
  readonly kind = "hermes" as const;

  constructor(private readonly _config: OperatorConfig) {}

  async load(_opts: { tokenId: bigint }): Promise<void> {
    throw new RuntimeError("HermesAgentRuntime not yet implemented — set AGENT_RUNTIME=openai-compat");
  }

  async bundleHash(_tokenId: bigint): Promise<Hex> {
    throw new RuntimeError("HermesAgentRuntime not yet implemented");
  }

  async runTask(_req: AgentTaskInput): Promise<AgentTaskOutput> {
    throw new RuntimeError("HermesAgentRuntime not yet implemented");
  }
}
