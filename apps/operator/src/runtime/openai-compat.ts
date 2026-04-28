/**
 * OpenAICompatRuntime — single-shot LLM call wrapped to satisfy the
 * AgentRuntime interface. No persisted state, no skills, no memory.
 *
 * This is the runtime for "raw model" agents: tokenize a fine-tune, accept
 * input, return output. The bundle hash is constant (the model identifier
 * itself), so bundleHashBefore == bundleHashAfter and the stateDeltaHash is
 * keccak(bundleHash || bundleHash). Honest and verifiable: a stateless
 * agent transitions from a state to itself.
 *
 * For demos: this powers `memer.stratum.eth` (the simple meme-coin auditor)
 * where the value is the prompt + base model, not accumulated skills.
 */

import { keccak256, toHex } from "viem";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { OperatorConfig } from "../config.ts";
import type { AgentStep } from "@stratum/shared";
import { measurementForToken } from "./measurement.ts";
import { RuntimeError, type AgentRuntime, type AgentTaskInput, type AgentTaskOutput, type Hex } from "./types.ts";

const SEED_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../seed/agents");

const FALLBACK_SYSTEM_PROMPT = `You are a helpful agent. Respond with concise JSON only — no prose, no markdown fences.`;

/** Cache of resolved system prompts keyed by tokenId string. */
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

export class OpenAICompatRuntime implements AgentRuntime {
  readonly kind = "openai-compat" as const;

  constructor(private readonly config: OperatorConfig) {}

  async load(_opts: { tokenId: bigint }): Promise<void> {
    // No state to hydrate.
  }

  async bundleHash(_tokenId: bigint): Promise<Hex> {
    // The "bundle" is just the model identity — there's nothing else to track.
    return keccak256(toHex(new TextEncoder().encode(`openai-compat:${this.config.COMPUTE_MODEL}`)));
  }

  async runTask(req: AgentTaskInput): Promise<AgentTaskOutput> {
    const url = `${this.config.COMPUTE_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.COMPUTE_API_KEY) headers["Authorization"] = `Bearer ${this.config.COMPUTE_API_KEY}`;

    const systemPrompt = await loadSystemPrompt(req.tokenId);
    const body = {
      model: this.config.COMPUTE_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: req.input },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      stream: false,
    };

    const tStart = Math.floor(Date.now() / 1000);

    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (err) {
      throw new RuntimeError(`backend unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable>");
      throw new RuntimeError(`backend ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; usage?: { prompt_tokens?: number; completion_tokens?: number } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) throw new RuntimeError("backend returned no content");
    const cleaned = extractFirstJsonObject(stripCodeFence(raw)) ?? stripCodeFence(raw);

    const inputBytes = new TextEncoder().encode(req.input);
    const outputBytes = new TextEncoder().encode(cleaned);
    const inputHash = keccak256(toHex(inputBytes));
    const outputHash = keccak256(toHex(outputBytes));

    const bundle = await this.bundleHash(req.tokenId);
    const stateDeltaHash = keccak256(`${bundle}${bundle.slice(2)}` as Hex);

    const transcript: AgentStep[] = [
      {
        kind: "llm",
        model: json.model ?? this.config.COMPUTE_MODEL,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
        ts: tStart,
      },
    ];

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
      teeQuote: Buffer.from(
        `stratum-testnet-no-tee-quote:runtime=openai-compat:tokenId=${req.tokenId}:model=${this.config.COMPUTE_MODEL}:ts=${Date.now()}`,
      ).toString("base64"),
      teeVendor: "intel-tdx",
      model: json.model ?? this.config.COMPUTE_MODEL,
      ts: Math.floor(Date.now() / 1000),
    };
  }
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
