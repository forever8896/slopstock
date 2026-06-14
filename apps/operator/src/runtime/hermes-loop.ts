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
 * Skills are surfaced as a Level-0 index (name + description) in the system
 * prompt; the agent pulls full bodies on demand via the skill_view tool
 * (progressive disclosure). After a hard task it creates/improves a skill.
 */

import type { AgentStep } from "@stratum/shared";
import type { Clients } from "../chain/clients.ts";
import type { OperatorConfig } from "../config.ts";
import type { BackendAttestation, LLMBackend } from "./llm-backend.ts";
import { type AgentTaskInput } from "./types.ts";
import type { SkillDoc, parseFrontmatter as _parseFrontmatter } from "./hermes.ts";
import { parseFrontmatter } from "./hermes.ts";
import { TOOL_REGISTRY, hashArgs, type ToolCtx } from "./hermes-tools.ts";
import { buildSkillIndex, upsertSkill } from "./skills.ts";
import { resolveSecret } from "../store/secrets.ts";
import type { FrozenMemory } from "./memory-files.ts";

const MAX_TURNS = 8;
const MIN_TOOLS_FOR_SKILL = 5; // was 3 — match real Hermes Agent's 5+ trigger

interface AgentStateLite {
  dir: string;
  db: import("bun:sqlite").Database;
  systemPrompt: string;
  skills: SkillDoc[];
  /** Optional tool whitelist. Manifest-driven runtimes pass the manifest's
   *  capabilities.tools; static (seed-driven) runtimes leave it undefined to
   *  expose the full TOOL_REGISTRY (preserves pre-Real-Agent-Launch behavior). */
  tools?: string[];
  frozenMemory?: FrozenMemory; // Layer 1 — embedded once, frozen for the session
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

/** Assemble the (frozen-for-the-session) system prompt. Skills appear as a
 *  Level-0 index only — bodies are pulled on demand via skill_view. Mirrors
 *  Hermes Agent's SKILLS_GUIDANCE block (index + creation nudge). */
export function buildSystemContent(opts: {
  systemPrompt: string;
  tools: { name: string; description: string }[];
  skillIndex: string;
  frozenMemory?: FrozenMemory;
}): string {
  const { systemPrompt, tools, skillIndex, frozenMemory } = opts;
  const parts: string[] = [systemPrompt.trim(), ""];

  if (frozenMemory && (frozenMemory.user.trim() || frozenMemory.memory.trim())) {
    parts.push("── what you remember (read-only this session) ──────────────");
    if (frozenMemory.user.trim()) parts.push(`USER:\n${frozenMemory.user.trim()}`);
    if (frozenMemory.memory.trim()) parts.push(`MEMORY:\n${frozenMemory.memory.trim()}`);
    parts.push("");
  }

  parts.push(
    "── available tools ──────────────────────────────────────────",
    tools.length === 0
      ? "(none — emit your final answer directly)"
      : tools.map((t) => `  - ${t.name}: ${t.description}`).join("\n"),
    "",
    "── how to call a tool ──────────────────────────────────────",
    `Emit a JSON object: {"tool": "<name>", "args": { ... }}`,
    "Nothing else. The runtime executes it and replies with the result on the next turn.",
    "",
    "── how to finish ───────────────────────────────────────────",
    `Emit ONLY a final JSON answer (an object that does NOT have a "tool" key). No prose, no markdown fences. The exact schema lives in your role definition above.`,
    "",
    "── your skills (Level 0 index) ─────────────────────────────",
    skillIndex,
    `To read a skill's full body, call {"tool":"skill_view","args":{"name":"<stem>"}}. When you finish a task that took 5+ tool calls or where you found a non-obvious path, SAVE it: {"tool":"skill_manage","args":{"op":"create","name":"<title>","content":"<markdown>"}} — or 'edit' an existing skill to improve it.`,
  );

  return parts.filter((x) => x !== "").join("\n");
}

/** Did the agent hit a tool error and then recover with a later success? Real
 *  Hermes treats "found the working path after a dead end" as skill-worthy,
 *  independent of raw tool count. Summaries flagged by the loop as errors use
 *  words like error/fail/threw/unknown/miss. */
export function sawErrorRecovery(transcript: AgentStep[]): boolean {
  let sawError = false;
  for (const s of transcript) {
    if (s.kind !== "tool") continue;
    const errored = /error|fail|threw|unknown|not whitelisted|\bmiss\b/i.test(s.resultSummary);
    if (errored) sawError = true;
    else if (sawError) return true;
  }
  return false;
}

export async function runAgentLoop(input: RunInput): Promise<RunResult> {
  const { config, state, req } = input;

  const transcript: AgentStep[] = [];
  const skillsLoaded = state.skills.map((s) => s.name);
  for (const skill of state.skills) {
    transcript.push({ kind: "skill_load", skill: skill.name, ts: Math.floor(Date.now() / 1000) });
  }

  const callId = crypto.randomUUID();

  // Build the conversation. The agent's system prompt drives behavior — it
  // carries the role definition, the workflow guidance, and the final-answer
  // schema. The loop only injects the generic tool-call protocol on top, so
  // any agent (audit-specialized or not) can use this runtime.
  //
  // Tool whitelist: if state.tools is set (manifest-driven runtime), only
  // those tools are exposed; otherwise the full TOOL_REGISTRY is offered
  // (matches static-trio behavior pre-Real-Agent-Launch).
  const allowedTools = state.tools ?? Object.keys(TOOL_REGISTRY);
  const toolList = allowedTools
    .map((name) => TOOL_REGISTRY[name])
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const systemContent = buildSystemContent({
    systemPrompt: state.systemPrompt,
    tools: toolList.map((t) => ({ name: t.name, description: t.description })),
    skillIndex: buildSkillIndex(state.skills),
    ...(state.frozenMemory ? { frozenMemory: state.frozenMemory } : {}),
  });

  const messages: ChatMsg[] = [
    { role: "system", content: systemContent },
    { role: "user", content: req.input },
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
    // Bind credential resolution to this agent. Present only when 1Claw is
    // configured; credentialed tools fail-soft otherwise.
    resolveSecret:
      config.ONECLAW_API_KEY && config.ONECLAW_VAULT_ID
        ? (secretRef: string) => resolveSecret(secretRef, { tokenId: req.tokenId, config })
        : undefined,
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
      const allowed = !state.tools || state.tools.includes(parsed.tool);
      const tool = allowed ? TOOL_REGISTRY[parsed.tool] : undefined;
      if (!tool) {
        const err = !allowed
          ? `tool '${parsed.tool}' is not in this agent's whitelist. allowed: ${(state.tools ?? Object.keys(TOOL_REGISTRY)).join(", ")}`
          : `unknown tool: ${parsed.tool}; available: ${Object.keys(TOOL_REGISTRY).join(", ")}`;
        messages.push({ role: "user", content: `tool error: ${err}` });
        transcript.push({
          kind: "tool",
          tool: parsed.tool,
          argsHash: hashArgs(parsed.args),
          resultSummary: allowed ? "unknown tool" : "tool not whitelisted",
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
      // Refuse final answers when the agent has tools available but skipped
      // them. Models occasionally fabricate "I called X" without actually
      // calling X — that's a integrity hole on stage. Force at least one
      // tool call before accepting a final answer.
      if (toolCallCount === 0 && Object.keys(state.tools ? Object.fromEntries(state.tools.map((t) => [t, 1])) : TOOL_REGISTRY).length > 0) {
        messages.push({
          role: "user",
          content:
            `Reject: you emitted a final answer without calling any tools. You have tools available — they exist precisely because you cannot answer this honestly without them. Call a relevant tool first via {"tool":"<name>","args":{...}}, see the real result, and ONLY THEN emit your final JSON. Do not invent data you did not fetch.`,
        });
        continue;
      }
      finalAnswer = parsed.json;
      break;
    }
    // Unparseable — push a nudge and try again.
    messages.push({
      role: "user",
      content: `Your previous output was neither a valid tool call nor a final JSON answer. Either emit {"tool":"<name>","args":{...}} or your final JSON object (no "tool" key, no markdown fences).`,
    });
  }

  if (!finalAnswer) {
    // Synthesize a generic stub so the subscriber gets something useful even
    // when the model failed to converge (small models sometimes loop). The
    // shape is intentionally generic — agent-specific schemas live in the
    // system prompt, and a "did-not-converge" stub doesn't owe a specific
    // schema; it owes honesty.
    finalAnswer = JSON.stringify(
      {
        status: "incomplete",
        note: "agent did not reach a final answer within turn limit",
        turnsUsed: MAX_TURNS,
        toolCallsMade: toolCallCount,
        model: modelLast,
      },
      null,
      2,
    );
  }

  // Skill auto-creation/improvement after a "hard" task. Slug-keyed upsert means
  // a recurring task type UPDATES its skill in place (self-improvement) instead
  // of spawning skill-<uuid>.md duplicates.
  const skillsCreated: string[] = [];
  const skillWorthy = toolCallCount >= MIN_TOOLS_FOR_SKILL || sawErrorRecovery(transcript);
  if (skillWorthy && finalAnswer) {
    try {
      const skill = await synthesizeSkill(input.backend, {
        userInput: req.input,
        transcript,
        finalAnswer,
      });
      if (skill) {
        const declaredName =
          skill.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? `skill-${callId.slice(0, 8)}`;
        const res = await upsertSkill(state.dir, declaredName, skill);
        skillsCreated.push(res.stem);
        transcript.push({ kind: "skill_create", skill: res.stem, ts: Math.floor(Date.now() / 1000) });
      }
    } catch {
      // Non-fatal; the audit still ships.
    }
  }

  // Write a task_log row for future recall.
  try {
    state.db
      .prepare("INSERT OR REPLACE INTO task_log(callId, tokenId, subscriber, ts, summary) VALUES (?,?,?,?,?)")
      .run(callId, req.tokenId.toString(), req.subscriber, Math.floor(Date.now() / 1000), summarizeFinalAnswer(finalAnswer));
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

/**
 * Best-effort one-line gist for the task_log. Tries common summary fields
 * (summary, answer, brief, status) so it works for any template's final-
 * answer schema; falls back to the first 180 chars of the raw JSON.
 */
function summarizeFinalAnswer(finalJson: string): string {
  try {
    const obj = JSON.parse(finalJson) as Record<string, unknown>;
    for (const k of ["summary", "answer", "brief", "concept", "status"]) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v.slice(0, 180);
    }
  } catch {
    /* fall through */
  }
  return finalJson.slice(0, 180);
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
  // Ask the LLM to write a Markdown skill doc summarizing this task's
  // approach. Fail-soft: if the model returns garbage, we just don't write
  // a skill this turn. Generic across agent kinds — the skill itself
  // captures whatever pattern the agent used.
  const sys =
    "You synthesize agentskills.io-format Markdown skills from completed agent tasks. " +
    "Output exactly: a YAML frontmatter block with name/description/triggers, then a body with steps and edge cases. " +
    "No prose outside the frontmatter+body. The skill should be reusable next time a similar task comes in.";
  const user =
    `An agent just completed a task. Synthesize the reusable knowledge.\n\n` +
    `INPUT (truncated):\n${input.userInput.slice(0, 800)}\n\n` +
    `TRANSCRIPT (kinds + summaries):\n${input.transcript.map((s) => `${s.kind}: ${describeStep(s)}`).join("\n")}\n\n` +
    `FINAL ANSWER (truncated):\n${input.finalAnswer.slice(0, 1200)}\n\n` +
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
