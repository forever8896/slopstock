/**
 * Tool registry the Hermes-pattern agent can invoke.
 *
 * Each tool: declares its name + JSON-schema args + free-form description,
 * and exposes a sync/async handler that returns a brief textual result the
 * model can use as the next turn's input. Handlers also return a
 * `resultSummary` which goes into the receipt transcript so subscribers
 * can audit which tools the agent used and their gist (without pulling the
 * full binary result into the chain-bound receipt).
 *
 * Today we ship four tools, all Solidity-flavored:
 *
 *   parse_ast(source)              — regex-driven structural scan
 *   pattern_search(pattern_name)   — keyword lookup over patterns/*.md
 *   recall(query)                  — full-text search over agent's memory
 *   note(key, value)               — write a fact into the agent's memory
 *
 * Adding a tool is a 10-line change: append to TOOL_REGISTRY.
 */

import { keccak256, toHex } from "viem";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

type Hex = `0x${string}`;

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for args (used only for prompt clarity; not validated). */
  argsSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

export interface ToolCtx {
  /** Original user input (Solidity source) — needed by parse_ast and similar. */
  input: string;
  /** Per-tokenId state directory. patterns/ and skills/ live here. */
  agentDir: string;
  /** Memory db (for recall + note). */
  db: Database;
  /** callId for memory writes. */
  callId: string;
}

export interface ToolResult {
  /** Free-form text the LLM sees as the tool's output. */
  text: string;
  /** Short summary for the receipt transcript (≤120 chars). */
  resultSummary: string;
  /** Optional structured payload (logged but not shown to LLM). */
  meta?: Record<string, unknown>;
}

// ─── Tools ─────────────────────────────────────────────────────────

const parseAst: ToolDef = {
  name: "parse_ast",
  description:
    "Extract a structural summary of the Solidity source (functions, modifiers, external calls, state variables). Use this once at the start to orient yourself.",
  argsSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, ctx) {
    const lines = ctx.input.split("\n");
    const fns: { name: string; line: number; visibility: string; mods: string[] }[] = [];
    const modifiers: { name: string; line: number }[] = [];
    const externalCalls: { line: number; snippet: string }[] = [];
    const stateVars: { line: number; snippet: string }[] = [];

    const fnRe =
      /\bfunction\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*((?:public|external|internal|private|view|pure|payable|virtual|override|nonReentrant|onlyOwner|[A-Za-z_]\w*)\s*)*/;
    const modRe = /\bmodifier\s+([A-Za-z_]\w*)\s*\(/;
    const extCallRe = /\.(call|delegatecall|staticcall|transfer|send)\s*[\{(]/;
    const stateVarRe = /^\s*(uint\d*|int\d*|address|bytes\d*|bool|string|mapping)\b[^;]*;/;

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i] ?? "";
      const fm = fnRe.exec(ln);
      if (fm) {
        const after = ln.slice(fm.index + fm[0].length);
        const visibility =
          /\bpublic\b/.test(ln) ? "public"
          : /\bexternal\b/.test(ln) ? "external"
          : /\binternal\b/.test(ln) ? "internal"
          : /\bprivate\b/.test(ln) ? "private"
          : "default";
        const mods = (ln.match(/\b(only[A-Z]\w*|nonReentrant|whenNotPaused|whenPaused|virtual|override)\b/g) ?? []);
        fns.push({ name: fm[1]!, line: i + 1, visibility, mods });
        void after;
      }
      const mm = modRe.exec(ln);
      if (mm) modifiers.push({ name: mm[1]!, line: i + 1 });
      if (extCallRe.test(ln)) externalCalls.push({ line: i + 1, snippet: ln.trim().slice(0, 120) });
      if (stateVarRe.test(ln) && !/function|modifier|event/.test(ln)) {
        stateVars.push({ line: i + 1, snippet: ln.trim().slice(0, 120) });
      }
    }

    const text =
      `Functions (${fns.length}):\n` +
      fns.map((f) => `  ${f.line}: ${f.name} [${f.visibility}]${f.mods.length ? " mods=" + f.mods.join(",") : ""}`).join("\n") +
      `\n\nModifiers (${modifiers.length}):\n` +
      modifiers.map((m) => `  ${m.line}: ${m.name}`).join("\n") +
      `\n\nExternal calls (${externalCalls.length}):\n` +
      externalCalls.map((c) => `  L${c.line}: ${c.snippet}`).join("\n") +
      `\n\nState variables (${stateVars.length}):\n` +
      stateVars.slice(0, 20).map((v) => `  L${v.line}: ${v.snippet}`).join("\n");

    return {
      text,
      resultSummary: `${fns.length} fns, ${externalCalls.length} ext calls, ${stateVars.length} state vars`,
      meta: { fns, modifiers, externalCalls, stateVars },
    };
  },
};

const patternSearch: ToolDef = {
  name: "pattern_search",
  description:
    "Search the agent's library of known vulnerability patterns. Pass `pattern_name` to retrieve a single pattern by its filename stem, or pass `query` to grep keywords across all patterns. Use this before claiming a finding so you can cite a known pattern.",
  argsSchema: {
    type: "object",
    properties: {
      pattern_name: { type: "string", description: "exact filename stem like 'reentrancy'" },
      query: { type: "string", description: "free-text grep across all pattern bodies" },
    },
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const dir = join(ctx.agentDir, "patterns");
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    } catch {
      return { text: "(no pattern library)", resultSummary: "no library" };
    }

    const name = typeof args["pattern_name"] === "string" ? (args["pattern_name"] as string) : null;
    const query = typeof args["query"] === "string" ? (args["query"] as string) : null;

    if (name) {
      const f = files.find((x) => x === `${name}.md` || x.replace(/\.md$/, "") === name);
      if (!f) {
        return { text: `(no pattern named '${name}'); available: ${files.map((x) => x.replace(/\.md$/, "")).join(", ")}`, resultSummary: `miss: ${name}` };
      }
      const body = await readFile(join(dir, f), "utf-8");
      return { text: body, resultSummary: `loaded pattern '${name}' (${body.length}b)` };
    }

    if (query) {
      const q = query.toLowerCase();
      const hits: string[] = [];
      for (const f of files) {
        const body = await readFile(join(dir, f), "utf-8");
        if (body.toLowerCase().includes(q)) {
          const lines = body.split("\n").slice(0, 6).join("\n");
          hits.push(`### ${f.replace(/\.md$/, "")}\n${lines}`);
        }
      }
      return {
        text: hits.length ? hits.join("\n\n") : `(no patterns match '${query}')`,
        resultSummary: `${hits.length} hits for '${query}'`,
      };
    }

    return {
      text: `Available patterns: ${files.map((x) => x.replace(/\.md$/, "")).join(", ")}`,
      resultSummary: `listed ${files.length} patterns`,
    };
  },
};

const recall: ToolDef = {
  name: "recall",
  description:
    "Search the agent's memory of past audits for relevant context. Useful when you suspect you've seen a similar contract before.",
  argsSchema: {
    type: "object",
    properties: { query: { type: "string", description: "search terms" } },
    required: ["query"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const query = String(args["query"] ?? "").trim();
    if (!query) return { text: "(empty query)", resultSummary: "empty query" };

    let rows: { content: string; ts: number; callId: string }[] = [];
    try {
      // FTS5 path
      rows = ctx.db
        .prepare(
          "SELECT content, ts, callId FROM messages WHERE messages MATCH ? ORDER BY ts DESC LIMIT 5",
        )
        .all(query) as typeof rows;
    } catch {
      // Fallback: LIKE
      rows = ctx.db
        .prepare(
          "SELECT content, ts, callId FROM messages WHERE content LIKE ? ORDER BY ts DESC LIMIT 5",
        )
        .all(`%${query}%`) as typeof rows;
    }

    if (rows.length === 0) {
      return { text: `(no memory for '${query}')`, resultSummary: `0 hits for '${query}'` };
    }

    const text = rows
      .map((r) => `[${new Date(r.ts).toISOString()}] callId=${r.callId.slice(0, 8)}: ${r.content.slice(0, 200)}`)
      .join("\n");
    return { text, resultSummary: `${rows.length} hits for '${query}'` };
  },
};

const note: ToolDef = {
  name: "note",
  description:
    "Write a short fact into the agent's persistent memory. Use sparingly — only for findings worth remembering across audits, not per-task scratchpad.",
  argsSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "short identifier" },
      value: { type: "string", description: "the fact to remember" },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const key = String(args["key"] ?? "").trim();
    const value = String(args["value"] ?? "").trim();
    if (!key || !value) return { text: "(missing key or value)", resultSummary: "skipped" };
    ctx.db
      .prepare("INSERT OR REPLACE INTO facts(key, value, ts) VALUES (?, ?, ?)")
      .run(key, value, Math.floor(Date.now() / 1000));
    return { text: `noted: ${key}`, resultSummary: `wrote fact: ${key}` };
  },
};

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  parse_ast: parseAst,
  pattern_search: patternSearch,
  recall,
  note,
};

/** Stable hash of a tool-call's args, for the receipt transcript. */
export function hashArgs(args: unknown): Hex {
  const json = JSON.stringify(args ?? {});
  return keccak256(toHex(new TextEncoder().encode(json)));
}

/** Render the tool list as a prompt fragment the LLM can consume. */
export function renderToolListForPrompt(): string {
  return Object.values(TOOL_REGISTRY)
    .map((t) => `  - ${t.name}: ${t.description}`)
    .join("\n");
}
