/**
 * 0G Compute client — orchestrates inference inside the Sealed Executor.
 *
 * Demo mode short-circuits the network call and returns a deterministic,
 * properly-shaped response so the rest of the system (MCP, receipts, attestation
 * verification on the subscriber side) can be exercised end-to-end without 0G
 * Compute access. Flip DEMO_MODE=false in env once the real endpoint is wired.
 */

import { keccak256, toHex } from "viem";
import type { OperatorConfig } from "../config.ts";
import type { InferenceRequest, InferenceResponse } from "./types.ts";

export interface ComputeClient {
  runInference(req: InferenceRequest): Promise<InferenceResponse>;
}

export function buildComputeClient(config: OperatorConfig): ComputeClient {
  if (config.DEMO_MODE) return new MockComputeClient();
  return new RealComputeClient(config);
}

/**
 * Demo-mode client: returns a pre-canned audit-shaped output so the rest of the
 * pipeline (receipt signing, MCP response shape, subscriber-side attestation
 * verification flow) can be tested without 0G Compute available.
 */
class MockComputeClient implements ComputeClient {
  async runInference(req: InferenceRequest): Promise<InferenceResponse> {
    const output = JSON.stringify(
      {
        summary: "Demo mode: 1 high-severity issue found.",
        findings: [
          {
            id: "AUDIT-001",
            severity: "HIGH",
            title: "Reentrancy in withdraw()",
            location: { file: "input.sol", lines: [42, 51] },
            description: "External call before state update enables classic reentrancy.",
            recommendation: "Apply checks-effects-interactions or use ReentrancyGuard.",
          },
        ],
        summaryStats: { high: 1, medium: 0, low: 0, informational: 0 },
        modelMeta: { model: "qwen2.5-coder-32b@stratum-audit-lora-v1", version: "0.1.0-demo" },
      },
      null,
      2,
    );

    const inputBytes = new TextEncoder().encode(req.input);
    const outputBytes = new TextEncoder().encode(output);
    const inputHash = keccak256(toHex(inputBytes));
    const outputHash = keccak256(toHex(outputBytes));

    // Deterministic fake measurement so subscriber-side verifiers can be tested.
    // In real mode, this comes from the TEE attestation.
    const measurement: `0x${string}` =
      "0x9a3f0000000000000000000000000000000000000000000000000000000000ff";

    return {
      output,
      inputHash,
      outputHash,
      teeQuote: Buffer.from("demo-mode-tee-quote-not-real").toString("base64"),
      measurement,
      teeVendor: "intel-tdx",
      model: "qwen2.5-coder-32b@stratum-audit-lora-v1",
      ts: Math.floor(Date.now() / 1000),
    };
  }
}

/**
 * Real 0G Compute client. Stub — once the actual proxy URL + auth model is
 * confirmed, this fills out: POST `${proxyUrl}/v1/chat/completions` with
 * OpenAI-shaped messages, parse the TEEML quote from response headers, hash
 * the output, build the response. Until then, holding the shape.
 */
class RealComputeClient implements ComputeClient {
  constructor(private readonly _config: OperatorConfig) {}

  async runInference(_req: InferenceRequest): Promise<InferenceResponse> {
    throw new Error("[stratum/operator] real 0G Compute client not yet implemented; set DEMO_MODE=true");
  }
}
