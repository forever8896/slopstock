/**
 * Real LLM compute client. Talks to any OpenAI-compatible Chat Completions
 * endpoint. Defaults target a local Ollama server (http://127.0.0.1:11434/v1)
 * but COMPUTE_BASE_URL + COMPUTE_API_KEY + COMPUTE_MODEL let any provider
 * (Together, vLLM, OpenRouter, etc.) plug in.
 *
 * The TEE-attestation portion is a known gap: we still emit the placeholder
 * measurement that the iNFT pins at mint time, since the real TEE quote pipe
 * lands when we fork 0gfoundation/0g-agent-nft. The compute itself is real —
 * the LLM analyzes the actual user input and produces an input-dependent audit.
 */

import { keccak256, toHex } from "viem";
import type { OperatorConfig } from "../config.ts";
import type { InferenceRequest, InferenceResponse } from "./types.ts";

export interface ComputeClient {
  runInference(req: InferenceRequest): Promise<InferenceResponse>;
}

export function buildComputeClient(config: OperatorConfig): ComputeClient {
  return new OpenAICompatibleComputeClient(config);
}

const SYSTEM_PROMPT = `You are an expert Solidity security auditor. Given a Solidity contract, you produce a JSON audit report — and ONLY a JSON object, no prose, no markdown fences.

Schema:
{
  "summary": "<one-line gist of the most important issue, or 'No high-severity issues found.'>",
  "findings": [
    {
      "id": "AUDIT-NNN",
      "severity": "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL",
      "title": "<short title>",
      "location": { "file": "input.sol", "lines": [<start>, <end>] },
      "description": "<why this is a problem, 1-3 sentences>",
      "recommendation": "<concrete fix, 1-2 sentences>"
    }
  ],
  "summaryStats": { "high": <n>, "medium": <n>, "low": <n>, "informational": <n> },
  "modelMeta": { "model": "<model id>", "version": "stratum-audit-v1" }
}

Rules:
- Use 1-based line numbers from the input.
- If you find no issues, return findings=[] and a clear summary.
- Be specific: cite the function name and line range.
- Do not wrap the JSON in markdown.`;

// Matches the value the iNFT pins at mint time (keccak(teeAttestation)). Real
// ERC-7857 produces this from a parsed TDX/SGX quote; we emit the placeholder
// so the subscriber-side AttestationBadge verification flow stays exercised.
const PINNED_MEASUREMENT: `0x${string}` =
  "0x3861e6d72751de965efb8993a0d96e38624b732ddc77a623d7c594ca807ffe37";

class OpenAICompatibleComputeClient implements ComputeClient {
  constructor(private readonly config: OperatorConfig) {}

  async runInference(req: InferenceRequest): Promise<InferenceResponse> {
    const url = `${this.config.COMPUTE_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.COMPUTE_API_KEY) {
      headers["Authorization"] = `Bearer ${this.config.COMPUTE_API_KEY}`;
    }

    const body = {
      model: this.config.COMPUTE_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: req.input },
      ],
      // Most providers (Ollama, OpenAI, Together) honor this. Ollama needs
      // `format: "json"` separately for strict JSON; we tolerate either.
      response_format: { type: "json_object" },
      temperature: 0.1,
      stream: false,
    };

    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (err) {
      throw new ComputeError(
        `compute backend unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable body>");
      throw new ComputeError(`compute backend ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) throw new ComputeError("compute backend returned no content");

    const output = stripCodeFence(raw).trim();
    // Best-effort: if the model wrapped JSON in prose, extract the first JSON
    // object. We don't validate the shape strictly here — the web app's
    // AuditOutput component is forgiving.
    const cleaned = extractFirstJsonObject(output) ?? output;

    const inputBytes = new TextEncoder().encode(req.input);
    const outputBytes = new TextEncoder().encode(cleaned);
    const inputHash = keccak256(toHex(inputBytes));
    const outputHash = keccak256(toHex(outputBytes));

    return {
      output: cleaned,
      inputHash,
      outputHash,
      // TEE quote is a placeholder until 0G Compute Sealed Executor is wired in.
      // We base64 a string that is honest about its provenance so a future verifier
      // can refuse it: it doesn't parse as a TDX/SGX quote and the iNFT pins the
      // expected measurement so quote-vs-measurement still binds.
      teeQuote: Buffer.from(
        `stratum-testnet-no-tee-quote:model=${this.config.COMPUTE_MODEL}:ts=${Date.now()}`,
      ).toString("base64"),
      measurement: PINNED_MEASUREMENT,
      teeVendor: "intel-tdx",
      model: json.model ?? this.config.COMPUTE_MODEL,
      ts: Math.floor(Date.now() / 1000),
    };
  }
}

export class ComputeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputeError";
  }
}

function stripCodeFence(s: string): string {
  const fenced = s.match(/^```(?:json)?\n([\s\S]*?)\n```\s*$/);
  if (fenced) return fenced[1] ?? s;
  return s;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
