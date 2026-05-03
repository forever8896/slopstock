/**
 * The Hermes-pattern agent loop.
 *
 * Each turn: feed the model the running message log, parse its response.
 * Two valid response shapes:
 *
 *   1. tool call:   {"tool":"<name>","args":{...}}
 *   2. final answer: a JSON object that does NOT have a `tool` field
 *                    (we identify it as "the audit JSON")
 *
 * The loop runs until we see a final answer or hit MAX_TURNS. Every step
 * is recorded into the transcript that lands in the receipt. Skill
 * auto-creation runs after the loop if the task involved enough tool
 * calls (≥ MIN_TOOLS_FOR_SKILL).
 *
 * Skills are loaded into the system prompt at task start. We don't do
 * per-turn skill matching for v1 — total skill body should fit in the
 * model's context. (Future: top-K retrieval if a skill set grows.)
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentStep } from "@stratum/shared";
import type { Clients } from "../chain/clients.ts";
import type { OperatorConfig } from "../config.ts";
import type { BackendAttestation, LLMBackend } from "./llm-backend.ts";
import { type AgentTaskInput } from "./types.ts";
import type { SkillDoc, parseFrontmatter as _parseFrontmatter } from "./hermes.ts";
import { parseFrontmatter } from "./hermes.ts";
import { TOOL_REGISTRY, hashArgs, renderToolListForPrompt, type ToolCtx } from "./hermes-tools.ts";

const MAX_TURNS = 8;
const MIN_TOOLS_FOR_SKILL = 3;

interface AgentStateLite {
  dir: string;
  db: import("bun:sqlite").Database;
  systemPrompt: string;
  skills: SkillDoc[];
}

interface RunInput {
  config: OperatorConfig;
  /** LLM backend (openai-compat or 0g-compute). All loop turns hit this. */
  backend: LLMBackend;
  state: AgentStateLite;
  req: AgentTaskInput;
  /** Optional — only present if tools need on-chain access (query_agent etc). */
  clients?: Clients;
  /** Where peer-agent calls go (defaults to this operator's own port). */
  peerOperatorUrl: string;
}

interface RunResult {
  output: string;
  transcript: AgentStep[];
  skillsLoaded: string[];
  skillsCreated: string[];
  model: string;
  /** Attestation from the LAST LLM call. The receipt's teeQuote is built
   *  from this — so for hermes runs on 0G Compute, the receipt carries
   *  the broker's verification of the final-answer turn. */
  lastAttestation: BackendAttestation;
}

interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export async function runAgentLoop(input: RunInput): Promise<RunResult> {
  const { config, state, req } = input;

  const transcript: AgentStep[] = [];
  const skillsLoaded = state.skills.map((s) => s.name);
  for (const skill of state.skills) {
    transcript.push({ kind: "skill_load", skill: skill.name, ts: Math.floor(Date.now() / 1000) });
  }

  const callId = crypto.randomUUID();

  // Build the conversation. System prompt + bundled skills + tool list +
  // the actual user input.
  const systemContent = [
    state.systemPrompt.trim(),
    "",
    "── available tools ──────────────────────────────────────────",
    renderToolListForPrompt(),
    "",
    "── how to call a tool ──────────────────────────────────────",
    `Emit a JSON object: {"tool": "<name>", "args": { ... }}`,
    "Nothing else. The runtime executes it and replies with the result on the next turn.",
    "",
    "── how to finish ───────────────────────────────────────────",
    "Emit ONLY the final audit JSON (with `summary`, `findings`, `summaryStats`, `modelMeta` keys, and NO `tool` key). No prose, no markdown fences.",
    "",
    "── workflow (MANDATORY ORDER) ──────────────────────────────",
    'Turn 1 — emit exactly: {"tool":"parse_ast","args":{}} — read back the function/state inventory.',
    'Turn 2 — if you saw any external call patterns, emit: {"tool":"pattern_search","args":{"pattern_name":"reentrancy"}} . If you saw any oracle/price reads (Uniswap getReserves, slot0, Chainlink, custom price math), emit instead: {"tool":"query_agent","args":{"agent":"oracles.slopstock.eth","input":"<concrete pair> spot price reliability assessment"}} — query_agent pays ORCL via x402 and you cite the response. Otherwise pattern_search a different pattern.',
    "Turn 3+ — call more tools as needed. Always cite a pattern body or peer-agent response in any finding's description.",
    "Final turn — emit ONLY the final JSON. No `tool` key.",
    "",
    "You must call AT LEAST ONE tool before emitting the final JSON. Skipping straight to a finding without tool calls is wrong — the receipt's transcript is part of how subscribers verify your work.",
    "",
    state.skills.length > 0 ? "── your accumulated skills ────────────────────────────────" : "",
    state.skills.length > 0
      ? state.skills.map((s) => `▸ ${s.name}: ${s.frontmatter["description"] ?? ""}\n${s.body.slice(0, 600)}`).join("\n\n")
      : "",
  ]
    .filter((x) => x !== "")
    .join("\n");

  const messages: ChatMsg[] = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: `Audit this Solidity source. Use tools as needed; do not output until you have a structured finding (or 'no issues found').\n\n--- input.sol ---\n${req.input}`,
    },
  ];

  // Persist initial user message to memory.
  insertMessage(state.db, callId, "user", req.input.slice(0, 2000));

  if (!input.clients) {
    // Without clients, query_agent can't fire — but the rest of the agent loop
    // works fine. We construct a partial ToolCtx so type-check passes; tools
    // that require chain access will fail-soft when invoked.
  }

  const toolCtx: ToolCtx = {
    input: req.input,
    agentDir: state.dir,
    db: state.db,
    callId,
    callerTokenId: req.tokenId,
    subscriber: req.subscriber,
    clients: input.clients,
    config,
    peerOperatorUrl: input.peerOperatorUrl,
  };

  let finalAnswer: string | null = null;
  let toolCallCount = 0;
  let modelLast = config.COMPUTE_MODEL;
  let lastAttestation: BackendAttestation = {
    kind: "none",
    backend: "openai-compat",
    baseUrl: config.COMPUTE_BASE_URL,
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const llmStart = Math.floor(Date.now() / 1000);
    const completion = await input.backend.call({
      messages,
      temperature: 0.1,
      jsonMode: false,
    });
    modelLast = completion.model;
    lastAttestation = completion.attestation;
    transcript.push({
      kind: "llm",
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      ts: llmStart,
    });
    insertMessage(state.db, callId, "assistant", completion.content.slice(0, 4000));

    // Parse the model's reply: tool call, final answer, or unparseable.
    const parsed = parseModelReply(completion.content);
    if (parsed.kind === "tool") {
      toolCallCount++;
      const tool = TOOL_REGISTRY[parsed.tool];
      if (!tool) {
        const err = `unknown tool: ${parsed.tool}; available: ${Object.keys(TOOL_REGISTRY).join(", ")}`;
        messages.push({ role: "user", content: `tool error: ${err}` });
        transcript.push({
          kind: "tool",
          tool: parsed.tool,
          argsHash: hashArgs(parsed.args),
          resultSummary: "unknown tool",
          ts: Math.floor(Date.now() / 1000),
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
      // Side effect: track memory_read/write for transparency.
      if (parsed.tool === "recall") {
        transcript.push({
          kind: "memory_read",
          query: String(parsed.args["query"] ?? "").slice(0, 80),
          resultCount: extractHitCount(result.resultSummary),
          ts: Math.floor(Date.now() / 1000),
        });
      } else if (parsed.tool === "note") {
        transcript.push({
          kind: "memory_write",
          key: String(parsed.args["key"] ?? "").slice(0, 80),
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
    // Unparseable — push a nudge and try again, or bail after 2 strikes.
    messages.push({
      role: "user",
      content: "Your previous output was neither a valid tool call nor a final audit JSON. Either emit `{\"tool\":\"<name>\",\"args\":{...}}` or the final audit JSON.",
    });
  }

  if (!finalAnswer) {
    // Synthesize a stub audit so the subscriber gets something useful even
    // when the model failed to converge (small models sometimes loop).
    finalAnswer = JSON.stringify(
      {
        summary: "Agent did not reach a final audit within turn limit.",
        findings: [],
        summaryStats: { high: 0, medium: 0, low: 0, informational: 0 },
        modelMeta: { model: modelLast, version: "stratum-audit-v1", note: "max-turns-exceeded" },
      },
      null,
      2,
    );
  }

  // Skill auto-creation if this was a "complex" task.
  const skillsCreated: string[] = [];
  if (toolCallCount >= MIN_TOOLS_FOR_SKILL && finalAnswer) {
    try {
      const skill = await synthesizeSkill(input.backend, {
        userInput: req.input,
        transcript,
        finalAnswer,
      });
      if (skill) {
        const fname = `skill-${crypto.randomUUID().slice(0, 8)}.md`;
        await writeFile(join(state.dir, "skills", fname), skill, "utf-8");
        const name = fname.replace(/\.md$/, "");
        skillsCreated.push(name);
        transcript.push({ kind: "skill_create", skill: name, ts: Math.floor(Date.now() / 1000) });
      }
    } catch {
      // Non-fatal; the audit still ships.
    }
  }

  // Write a task_log row for future recall/audit.
  try {
    state.db
      .prepare("INSERT OR REPLACE INTO task_log(callId, tokenId, subscriber, ts, summary) VALUES (?,?,?,?,?)")
      .run(callId, req.tokenId.toString(), req.subscriber, Math.floor(Date.now() / 1000), summarizeAudit(finalAnswer));
  } catch {
    // Tolerate schema issues (older bun builds).
  }

  return {
    output: finalAnswer,
    transcript,
    skillsLoaded,
    skillsCreated,
    model: modelLast,
    lastAttestation,
  };
}

// ─── Reply parsing ────────────────────────────────────────────────

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
  // Treat any other JSON object as the final answer. Pretty-print so the
  // web UI's AuditOutput renders it cleanly.
  return { kind: "final", json: JSON.stringify(parsed, null, 2) };
}

function stripCodeFence(s: string): string {
  const fenced = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
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

function extractHitCount(summary: string): number {
  const m = summary.match(/(\d+)\s*hits?/);
  return m ? Number(m[1]) : 0;
}

function summarizeAudit(finalJson: string): string {
  try {
    const obj = JSON.parse(finalJson) as { summary?: string };
    return (obj.summary ?? "").slice(0, 180);
  } catch {
    return finalJson.slice(0, 180);
  }
}

function insertMessage(db: import("bun:sqlite").Database, callId: string, role: string, content: string): void {
  try {
    db.prepare("INSERT INTO messages(callId, role, content, ts) VALUES (?,?,?,?)").run(
      callId,
      role,
      content,
      Math.floor(Date.now() / 1000),
    );
  } catch {
    // Schema may differ between FTS5 and fallback; tolerate.
  }
}

// ─── Skill synthesis ──────────────────────────────────────────────

interface SkillSynthInput {
  userInput: string;
  transcript: AgentStep[];
  finalAnswer: string;
}

async function synthesizeSkill(backend: LLMBackend, input: SkillSynthInput): Promise<string | null> {
  // Ask the LLM to write a Markdown skill doc summarizing this audit's
  // approach. Fail-soft: if the model returns garbage, we just don't write
  // a skill this turn.
  const sys =
    "You synthesize agentskills.io-format Markdown skills from completed agent tasks. " +
    "Output exactly: a YAML frontmatter block with name/description/triggers, then a body with steps and edge cases. " +
    "No prose outside the frontmatter+body. The skill should be reusable next time a similar audit comes in.";
  const user =
    `An agent just completed an audit. Synthesize the reusable knowledge.\n\n` +
    `INPUT (truncated):\n${input.userInput.slice(0, 800)}\n\n` +
    `TRANSCRIPT (kinds + summaries):\n${input.transcript.map((s) => `${s.kind}: ${describeStep(s)}`).join("\n")}\n\n` +
    `FINAL FINDING SUMMARY:\n${input.finalAnswer.slice(0, 1200)}\n\n` +
    `Write the skill (frontmatter + body):`;
  const result = await backend
    .call({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    })
    .catch(() => null);
  if (!result) return null;
  const out = result.content.trim();
  if (!out.startsWith("---")) {
    // Wrap as best-effort frontmatter.
    return `---\nname: skill-${Date.now()}\ndescription: auto-generated from a completed audit task\ntriggers: solidity\n---\n${out}`;
  }
  return out;
}

function describeStep(s: AgentStep): string {
  switch (s.kind) {
    case "llm": return `model=${s.model}`;
    case "tool": return `${s.tool} → ${s.resultSummary}`;
    case "skill_load": return s.skill;
    case "skill_create": return s.skill;
    case "memory_read": return `${s.query} (${s.resultCount})`;
    case "memory_write": return s.key;
  }
}

// satisfy unused import lint
void (parseFrontmatter as typeof _parseFrontmatter);
