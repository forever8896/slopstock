/**
 * OpenAICompatRuntime — single-shot LLM call wrapped to satisfy the
 * AgentRuntime interface. No persisted state, no skills, no memory.
 *
 * The runtime layer doesn't care which LLM backend is behind it; it takes
 * an LLMBackend and calls it once. The backend can be:
 *   - OpenAICompatBackend: hits any OpenAI-shaped HTTP endpoint
 *   - ZGComputeBackend:    routes through the 0G Compute Network broker
 *                          (TeeML-verified sealed inference)
 *
 * Per-tokenId system prompts come from apps/operator/seed/agents/<id>/
 * system.md.
 */

import { keccak256, toHex } from "viem";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { AgentStep } from "@stratum/shared";
import type { LLMBackend } from "./llm-backend.ts";
import { measurementForToken } from "./measurement.ts";
import { type AgentRuntime, type AgentTaskInput, type AgentTaskOutput, type Hex } from "./types.ts";

const SEED_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../seed/agents");

const FALLBACK_SYSTEM_PROMPT = `You are a helpful agent. Respond with concise JSON only — no prose, no markdown fences.`;

const promptCache = new Map<string, string>();

async function loadSystemPrompt(tokenId: bigint): Promise<string> {
  const key = tokenId.toString();
  const cached = promptCache.get(key);
  if (cached) return cached;
  const path = join(SEED_ROOT, key, "system.md");
  const prompt = existsSync(path) ? await readFile(path, "utf-8") : FALLBACK_SYSTEM_PROMPT;
  promptCache.set(key, prompt);
  return prompt;
}

export interface OpenAICompatRuntimeOpts {
  /** Override the seed-file system prompt — used by the dynamic registry
   *  so /launch agents serve their user-defined personality immediately. */
  systemPromptOverride?: string;
}

export class OpenAICompatRuntime implements AgentRuntime {
  readonly kind = "openai-compat" as const;

  constructor(
    private readonly backend: LLMBackend,
    private readonly opts: OpenAICompatRuntimeOpts = {},
  ) {}

  async load(_opts: { tokenId: bigint }): Promise<void> {
    // No state to hydrate.
  }

  async bundleHash(_tokenId: bigint): Promise<Hex> {
    // The "bundle" is the backend's identity + the system prompt. For
    // dynamic agents the prompt is the only differentiator, so include it.
    const promptTag = this.opts.systemPromptOverride
      ? keccak256(toHex(new TextEncoder().encode(this.opts.systemPromptOverride))).slice(2, 14)
      : "static";
    return keccak256(toHex(new TextEncoder().encode(`runtime=openai-compat:backend=${this.backend.kind}:${this.backend.description}:prompt=${promptTag}`)));
  }

  async runTask(req: AgentTaskInput): Promise<AgentTaskOutput> {
    const systemPrompt = this.opts.systemPromptOverride ?? (await loadSystemPrompt(req.tokenId));
    const tStart = Math.floor(Date.now() / 1000);

    const llm = await this.backend.call({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: req.input },
      ],
      temperature: 0.1,
      jsonMode: true,
    });

    const cleaned = extractFirstJsonObject(stripCodeFence(llm.content)) ?? stripCodeFence(llm.content);

    const inputBytes = new TextEncoder().encode(req.input);
    const outputBytes = new TextEncoder().encode(cleaned);
    const inputHash = keccak256(toHex(inputBytes));
    const outputHash = keccak256(toHex(outputBytes));

    const bundle = await this.bundleHash(req.tokenId);
    const stateDeltaHash = keccak256(`${bundle}${bundle.slice(2)}` as Hex);

    const transcript: AgentStep[] = [
      {
        kind: "llm",
        model: llm.model,
        promptTokens: llm.promptTokens,
        completionTokens: llm.completionTokens,
        ts: tStart,
      },
    ];

    // Encode backend attestation into the receipt's teeQuote slot:
    //   - openai-compat: honest "no real quote" string
    //   - 0g-compute:    base64 of JSON {provider, chatId, isValid}
    const teeQuote = encodeAttestation(llm.attestation);

    return {
      output: cleaned,
      inputHash,
      outputHash,
      transcript,
      bundleHashBefore: bundle,
      bundleHashAfter: bundle,
      stateDeltaHash,
      skillsLoaded: [],
      skillsCreated: [],
      measurement: measurementForToken(req.tokenId),
      teeQuote,
      teeVendor: "intel-tdx",
      model: llm.model,
      ts: Math.floor(Date.now() / 1000),
      backendAttestation: llm.attestation,
    };
  }
}

function encodeAttestation(att: import("./llm-backend.ts").BackendAttestation): string {
  if (att.kind === "0g-tee") {
    const blob = JSON.stringify({
      kind: "0g-tee",
      provider: att.provider,
      chatId: att.chatId,
      isValid: att.isValid,
    });
    return Buffer.from(blob).toString("base64");
  }
  return Buffer.from(
    `stratum-testnet-no-tee-quote:backend=openai-compat:url=${att.baseUrl}:ts=${Date.now()}`,
  ).toString("base64");
}

function stripCodeFence(s: string): string {
  const fenced = s.match(/^```(?:json)?\n([\s\S]*?)\n```\s*$/);
  return fenced ? (fenced[1] ?? s) : s;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (inString) { if (ch === "\\") escape = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}
