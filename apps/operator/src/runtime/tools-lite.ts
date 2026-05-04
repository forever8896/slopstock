/**
 * tools-lite runtime — middle tier between openai-compat (one-shot) and
 * hermes (full stateful agent).
 *
 * tools-lite agents:
 *   - read their system prompt + patterns + skills from a materialized
 *     manifest (shipped via 0G Storage at mint)
 *   - run a multi-turn agent loop with a tool whitelist from the manifest
 *   - have ephemeral :memory: SQLite for `recall` / `note` (fresh per call)
 *   - bundleHash == manifest hash (read-only — no state mutation across calls)
 *
 * This is the runtime the typical permissionless agent runs at — full
 * tool-call story, full receipt transcript, but no persistent memory across
 * subscribers. Hermes adds persistence on top (Phase 2).
 *
 * Loop is general-purpose (not audit-specialized): system prompt and final-
 * answer schema come from the template. The model emits either a tool call
 * `{"tool":..., "args":...}` or a final JSON object.
 */

import { Database } from "bun:sqlite";
import { keccak256, toHex } from "viem";

import type { AgentStep, Hex } from "@stratum/shared";

import type { Clients } from "../chain/clients.ts";
import type { OperatorConfig } from "../config.ts";
import type { LLMBackend, BackendAttestation } from "./llm-backend.ts";
import { measurementForToken } from "./measurement.ts";
import {
  RuntimeError,
  type AgentRuntime,
  type AgentTaskInput,
  type AgentTaskOutput,
} from "./types.ts";
import {
  TOOL_REGISTRY,
  hashArgs,
  type ToolCtx,
  type ToolDef,
} from "./hermes-tools.ts";
import type { MaterializedManifest } from "./manifest-loader.ts";

const MAX_TURNS = 6;

export interface ToolsLiteOpts {
  manifest: MaterializedManifest;
  config: OperatorConfig;
  /** Optional — needed for query_agent / onchain_read tools to work end-to-end. */
  clients?: Clients;
  peerOperatorUrl?: string;
}

export class ToolsLiteRuntime implements AgentRuntime {
  readonly kind = "openai-compat" as const;

  private readonly peerOperatorUrl: string;
  private readonly manifestHashHex: Hex;
  private readonly tools: Record<string, ToolDef>;

  constructor(
    private readonly backend: LLMBackend,
    private readonly opts: ToolsLiteOpts,
  ) {
    this.peerOperatorUrl =
      opts.peerOperatorUrl ?? `http://127.0.0.1:${opts.config.HTTP_PORT}`;
    this.manifestHashHex = `0x${opts.manifest.manifestHash}` as Hex;
    // Whitelist tools per manifest.capabilities.tools. Unknown names are
    // silently dropped so the LLM literally never sees a tool the creator
    // didn't enable.
    const allow = new Set(opts.manifest.manifest.capabilities.tools);
    const filtered: Record<string, ToolDef> = {};
    for (const [name, def] of Object.entries(TOOL_REGISTRY)) {
      if (allow.has(name as never)) filtered[name] = def;
    }
    this.tools = filtered;
  }

  async load(): Promise<void> {
    // Stateless across calls — nothing to hydrate.
  }

  async bundleHash(): Promise<Hex> {
    return this.manifestHashHex;
  }

  async runTask(req: AgentTaskInput): Promise<AgentTaskOutput> {
    const transcript: AgentStep[] = [];
    const callId = crypto.randomUUID();
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts ( key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL );
      CREATE TABLE IF NOT EXISTS messages ( callId TEXT, role TEXT, content TEXT, ts INTEGER );
      CREATE INDEX IF NOT EXISTS idx_messages_call ON messages(callId);
    `);

    const toolList = Object.values(this.tools);
    const systemContent = [
      this.opts.manifest.manifest.brain.systemPrompt.trim(),
      "",
      "── available tools ──────────────────────────────────────────",
      toolList.length === 0
        ? "(none — emit your final JSON directly)"
        : toolList.map((t) => `  - ${t.name}: ${t.description}`).join("\n"),
      "",
      "── how to call a tool ──────────────────────────────────────",
      `Emit a JSON object: {"tool": "<name>", "args": { ... }}`,
      "Nothing else. The runtime executes it and replies with the result on the next turn.",
      "",
      "── how to finish ───────────────────────────────────────────",
      `Emit ONLY the final JSON answer (an object that does NOT have a "tool" key).`,
      `No prose, no markdown fences.`,
    ].join("\n");

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemContent },
      { role: "user", content: req.input },
    ];

    const toolCtx: ToolCtx = {
      input: req.input,
      agentDir: this.opts.manifest.agentDir,
      db,
      callId,
      callerTokenId: req.tokenId,
      subscriber: req.subscriber,
      ...(this.opts.clients ? { clients: this.opts.clients } : {}),
      config: this.opts.config,
      peerOperatorUrl: this.peerOperatorUrl,
    };

    let finalAnswer: string | null = null;
    let modelLast = this.backend.kind === "0g-compute" ? "0g-compute" : "openai-compat";
    let lastAttestation: BackendAttestation =
      this.backend.kind === "0g-compute"
        ? { kind: "0g-tee", backend: "0g-compute", provider: "0x0" as Hex, chatId: "", isValid: false }
        : { kind: "none", backend: "openai-compat", baseUrl: this.opts.config.COMPUTE_BASE_URL };

    let llmCallsMade = 0;

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const tStart = Math.floor(Date.now() / 1000);
        const completion = await this.backend.call({
          messages,
          temperature: 0.1,
          jsonMode: false,
        });
        modelLast = completion.model;
        lastAttestation = completion.attestation;
        llmCallsMade++;
        transcript.push({
          kind: "llm",
          model: completion.model,
          promptTokens: completion.promptTokens,
          completionTokens: completion.completionTokens,
          ts: tStart,
        });
        messages.push({ role: "assistant", content: completion.content });

        const parsed = parseModelReply(completion.content);
        if (parsed.kind === "tool") {
          const tool = this.tools[parsed.tool];
          if (!tool) {
            transcript.push({
              kind: "tool",
              tool: parsed.tool,
              argsHash: hashArgs(parsed.args),
              resultSummary: `unknown tool '${parsed.tool}'`,
              ts: Math.floor(Date.now() / 1000),
            });
            messages.push({
              role: "user",
              content: `tool error: '${parsed.tool}' is not in your whitelist. allowed: ${Object.keys(this.tools).join(", ") || "(none)"}`,
            });
            continue;
          }
          let result;
          try {
            result = await tool.handler(parsed.args, toolCtx);
          } catch (e) {
            result = {
              text: `tool '${parsed.tool}' threw: ${e instanceof Error ? e.message : String(e)}`,
              resultSummary: "errored",
            };
          }
          transcript.push({
            kind: "tool",
            tool: parsed.tool,
            argsHash: hashArgs(parsed.args),
            resultSummary: result.resultSummary.slice(0, 120),
            ts: Math.floor(Date.now() / 1000),
          });
          if (parsed.tool === "note") {
            transcript.push({
              kind: "memory_write",
              key: String(parsed.args["key"] ?? "").slice(0, 80),
              ts: Math.floor(Date.now() / 1000),
            });
          } else if (parsed.tool === "recall") {
            transcript.push({
              kind: "memory_read",
              query: String(parsed.args["query"] ?? "").slice(0, 80),
              resultCount: 0,
              ts: Math.floor(Date.now() / 1000),
            });
          }
          messages.push({
            role: "user",
            content: `[tool ${parsed.tool} result]\n${result.text}`,
          });
          continue;
        }
        if (parsed.kind === "final") {
          finalAnswer = parsed.json;
          break;
        }
        // Unparseable — nudge.
        messages.push({
          role: "user",
          content: `Your previous output was neither a valid tool call nor a final JSON answer. Emit either {"tool":"<name>","args":{...}} or your final JSON object.`,
        });
      }
    } finally {
      db.close();
    }

    if (!finalAnswer) {
      // Synthesize a stub answer rather than throw — subscriber paid, deliver
      // something useful even when the model failed to converge.
      finalAnswer = JSON.stringify(
        {
          status: "incomplete",
          note: "agent did not reach a final answer within turn limit",
          llmCalls: llmCallsMade,
          template: this.opts.manifest.manifest.brain.templateId,
        },
        null,
        2,
      );
    }

    if (llmCallsMade === 0) {
      throw new RuntimeError("backend produced no LLM calls — runtime cannot return receipt");
    }

    const inputBytes = new TextEncoder().encode(req.input);
    const outputBytes = new TextEncoder().encode(finalAnswer);
    const inputHash = keccak256(toHex(inputBytes));
    const outputHash = keccak256(toHex(outputBytes));
    const bundle = this.manifestHashHex;
    const stateDelta = keccak256(`${bundle}${bundle.slice(2)}` as Hex);

    return {
      output: finalAnswer,
      inputHash,
      outputHash,
      transcript,
      bundleHashBefore: bundle,
      bundleHashAfter: bundle,
      stateDeltaHash: stateDelta,
      skillsLoaded: this.opts.manifest.manifest.capabilities.skills.map((s) => s.name),
      skillsCreated: [],
      measurement: measurementForToken(req.tokenId),
      teeQuote: encodeAttestation(lastAttestation, bundle, req.tokenId),
      teeVendor: "intel-tdx",
      model: modelLast,
      ts: Math.floor(Date.now() / 1000),
      backendAttestation: lastAttestation,
    };
  }
}

function encodeAttestation(att: BackendAttestation, bundle: Hex, tokenId: bigint): string {
  if (att.kind === "0g-tee") {
    return Buffer.from(
      JSON.stringify({
        kind: "0g-tee",
        provider: att.provider,
        chatId: att.chatId,
        isValid: att.isValid,
        bundleHash: bundle,
        tier: "tools-lite",
      }),
    ).toString("base64");
  }
  return Buffer.from(
    `stratum-testnet-no-tee-quote:runtime=tools-lite:tokenId=${tokenId}:bundle=${bundle}:url=${att.baseUrl}:ts=${Date.now()}`,
  ).toString("base64");
}

type ParsedReply =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "final"; json: string }
  | { kind: "unparseable" };

function parseModelReply(content: string): ParsedReply {
  const stripped = stripCodeFence(content).trim();
  const firstObj = extractFirstJsonObject(stripped);
  if (!firstObj) return { kind: "unparseable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstObj);
  } catch {
    return { kind: "unparseable" };
  }
  if (parsed && typeof parsed === "object" && "tool" in parsed) {
    const obj = parsed as { tool?: unknown; args?: unknown };
    if (typeof obj.tool === "string") {
      const args = (obj.args && typeof obj.args === "object" ? obj.args : {}) as Record<string, unknown>;
      return { kind: "tool", tool: obj.tool, args };
    }
  }
  return { kind: "final", json: JSON.stringify(parsed, null, 2) };
}

function stripCodeFence(s: string): string {
  const fenced = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenced ? (fenced[1] ?? s) : s;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0,
    inString = false,
    escape = false;
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
