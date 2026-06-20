/**
 * Drill-Cypher step 1 — drill lyric generation on 0G Compute (deepseek-v3 TEE).
 *
 * Single-shot inference (no tool loop): system = drill-craft moat, user = the
 * opps to roast. The model returns structured JSON { lyrics, style_prompt }.
 * The inference fn is injectable so this is unit-testable without 0G; the
 * default routes through the 0G broker exactly like the demo-script agent.
 *
 * Credential isolation: the lyrics model NEVER sees the ElevenLabs key — that
 * is resolved later, at the audio tool layer (tools.ts), via 1Claw.
 */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] ??= "0";

import { DRILL_CYPHER_SYSTEM_PROMPT } from "@stratum/shared";

const MAINNET_RPC = "https://evmrpc.0g.ai";
const DEFAULT_PROVIDER = "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0" as `0x${string}`;

export type DrillStyle = "uk-drill" | "ny-drill";

export interface DrillInput {
  opps: string[];
  style?: DrillStyle;
  extraBars?: string;
}

export interface DrillLyrics {
  lyrics: string;
  stylePrompt: string;
  bars: number;
}

/** (system, user) -> raw model text. Injected in tests; 0G in production. */
export type InferFn = (system: string, user: string) => Promise<string>;

export interface GenerateLyricsDeps {
  infer?: InferFn;
  providerAddress?: `0x${string}`;
}

export function buildPrompts(input: DrillInput): { system: string; user: string } {
  const style: DrillStyle = input.style ?? "ny-drill";
  const extra = input.extraBars ? `\n\nExtra context to weave in: ${input.extraBars}` : "";
  const user =
    `Write a ${style} drill cypher roasting these opps: ${input.opps.join(", ")}.` +
    extra +
    `\n\nReturn ONLY the JSON object specified in your instructions.`;
  return { system: DRILL_CYPHER_SYSTEM_PROMPT, user };
}

/** Strip ```json fences and parse into DrillLyrics; count line-broken bars. */
export function parseLyricsResponse(raw: string): DrillLyrics {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let obj: { lyrics?: string; style_prompt?: string };
  try {
    obj = JSON.parse(cleaned) as typeof obj;
  } catch {
    // Fallback: pull the first {...} block if the model added stray prose.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("model did not return parseable JSON lyrics");
    obj = JSON.parse(m[0]) as typeof obj;
  }
  const lyrics = (obj.lyrics ?? "").trim();
  const stylePrompt = (obj.style_prompt ?? "").trim();
  if (!lyrics) throw new Error("model returned empty lyrics");
  // Bars are delimited by newlines OR " / " (models often write multiple bars
  // per line separated by slashes). Count both so the metric reflects real bars.
  const bars = lyrics
    .split(/\n|\s+\/\s+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length;
  return { lyrics, stylePrompt, bars };
}

export async function generateDrillLyrics(input: DrillInput, deps: GenerateLyricsDeps = {}): Promise<DrillLyrics> {
  if (!input.opps || input.opps.length === 0) throw new Error("at least one opp is required");
  const { system, user } = buildPrompts(input);
  const infer = deps.infer ?? makeDefault0gInfer(deps.providerAddress ?? DEFAULT_PROVIDER);
  const raw = await infer(system, user);
  return parseLyricsResponse(raw);
}

/** Default inference: 0G Compute broker + OpenAI-shaped call (deepseek-v3 TEE). */
function makeDefault0gInfer(providerAddress: `0x${string}`): InferFn {
  return async (system, user) => {
    const { ethers } = await import("ethers");
    const { createZGComputeNetworkBroker } = await import("@0gfoundation/0g-compute-ts-sdk");
    const OpenAI = (await import("openai")).default;

    const key = process.env["OPERATOR_PRIVATE_KEY"];
    if (!key) throw new Error("OPERATOR_PRIVATE_KEY env var is required for 0G Compute");
    const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
    const wallet = new ethers.Wallet(key, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    try { await broker.inference.acknowledgeProviderSigner(providerAddress); } catch { /* already acked */ }
    const meta = await broker.inference.getServiceMetadata(providerAddress);
    const headers = await broker.inference.getRequestHeaders(providerAddress, user.slice(0, 100));
    const client = new OpenAI({ baseURL: meta.endpoint as string, apiKey: "", defaultHeaders: headers as unknown as Record<string, string> });
    const res = (await client.chat.completions.create({
      model: meta.model as string,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.9,
      max_tokens: 1200,
    } as Parameters<typeof client.chat.completions.create>[0])) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return res.choices?.[0]?.message?.content ?? "";
  };
}
