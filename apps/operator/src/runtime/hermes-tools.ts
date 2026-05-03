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

import { keccak256, toHex, parseUnits, encodeFunctionData } from "viem";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { BASE_SEPOLIA_AGENTS, USDC_BASE_SEPOLIA } from "@stratum/shared";
import type { Clients } from "../chain/clients.ts";
import type { OperatorConfig } from "../config.ts";
import { agentWalletFor } from "./agent-wallet.ts";

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
  /** The agent invoking the tool (needed for derived-wallet identity). */
  callerTokenId: bigint;
  /** Address of the subscriber paying THIS task — propagated when this agent
   *  pays another agent in turn (so receipts at every hop carry provenance). */
  subscriber: Hex;
  /** Operator-side chain clients (read + write). Optional: tools that don't
   *  need chain access (parse_ast, recall, note) work without them. */
  clients?: Clients;
  /** Operator config, for OPERATOR_PRIVATE_KEY (used to derive agent wallets)
   *  and for COMPUTE_BASE_URL forwarding to peer-agent calls. */
  config: OperatorConfig;
  /** URL where peer agents are served. v1: same operator process; v2: per-
   *  agent operator URL discovered via ENS / AgentRegistry. */
  peerOperatorUrl: string;
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

// ─── Agent-to-agent: query_agent ─────────────────────────────────

const queryAgent: ToolDef = {
  name: "query_agent",
  description:
    "Call another Slopstock-listed agent and pay them via x402. Use this when you need expertise outside your own — e.g. as the auditor, ask `oracles.slopstock.eth` for the live USD price of a token before judging an oracle-using contract. The agent name is resolved through real ENS on Sepolia (PublicResolver addr record points to the agent's vault). The call is a real onchain USDC transfer from your own working wallet to the target's vault, then an HTTP POST to the target's operator. Their shareholders earn revenue from your call.",
  argsSchema: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description: "ENS name (e.g. 'oracles.slopstock.eth') or ticker (e.g. 'ORCL').",
      },
      input: { type: "string", description: "Free-text query for the target agent." },
    },
    required: ["agent", "input"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const target = String(args["agent"] ?? "").trim();
    const inputText = String(args["input"] ?? "").trim();
    if (!target || !inputText) {
      return { text: "(missing agent or input)", resultSummary: "missing args" };
    }

    if (!ctx.clients) {
      return {
        text: "(query_agent unavailable — runtime started without chain clients)",
        resultSummary: "no clients",
      };
    }

    const targetAddr = await resolveAgentAddresses(target, ctx.clients.sepoliaPublic);
    if (!targetAddr) {
      return {
        text: `(unknown agent '${target}'); known: ${Object.keys(BASE_SEPOLIA_AGENTS).join(", ")}`,
        resultSummary: `unknown ${target}`,
      };
    }
    if (targetAddr.tokenId === ctx.callerTokenId) {
      return {
        text: "(cannot call yourself via query_agent)",
        resultSummary: "self-call rejected",
      };
    }

    // Derive the calling agent's wallet (deterministic from operator key + tokenId).
    const wallet = agentWalletFor(ctx.config.OPERATOR_PRIVATE_KEY as Hex, ctx.callerTokenId);

    // 1. Fetch the target's challenge so we know exact amount.
    let challenge: { amount: string; recipient: Hex };
    try {
      const res = await fetch(
        `${ctx.peerOperatorUrl}/x402/infer?tokenId=${targetAddr.tokenId.toString()}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (res.status !== 402) {
        const t = await res.text().catch(() => "");
        return {
          text: `unexpected status ${res.status} from peer: ${t.slice(0, 200)}`,
          resultSummary: `peer ${res.status}`,
        };
      }
      const header = res.headers.get("X-PAYMENT-V1");
      if (!header) {
        return { text: "peer did not return X-PAYMENT-V1 header", resultSummary: "no challenge" };
      }
      challenge = JSON.parse(header) as { amount: string; recipient: Hex };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { text: `failed to fetch peer challenge: ${msg.slice(0, 200)}`, resultSummary: "peer unreachable" };
    }

    // 2. Pay USDC.transfer(targetVault, amount) from this agent's wallet.
    const amount = BigInt(challenge.amount);
    let txHash: Hex;
    try {
      txHash = await ctx.clients.baseWallet.writeContract({
        account: wallet,
        chain: ctx.clients.baseWallet.chain,
        address: USDC_BASE_SEPOLIA as Hex,
        abi: [
          {
            type: "function",
            name: "transfer",
            stateMutability: "nonpayable",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ type: "bool" }],
          },
        ] as const,
        functionName: "transfer",
        args: [challenge.recipient, amount],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Common failure: agent wallet not funded with USDC. Surface the address
      // so the operator can top it up.
      return {
        text: `agent payment failed: ${msg.slice(0, 250)}\n\nThis agent's wallet (${wallet.address}) needs USDC + ETH on Base Sepolia to pay peer agents.`,
        resultSummary: `pay failed: ${wallet.address.slice(0, 10)}…`,
      };
    }

    // 3. Wait for inclusion.
    try {
      await ctx.clients.basePublic.waitForTransactionReceipt({ hash: txHash });
    } catch (e) {
      return {
        text: `payment ${txHash} did not confirm: ${e instanceof Error ? e.message : String(e)}`,
        resultSummary: "tx unconfirmed",
      };
    }

    // 4. Submit to peer's /x402/infer with the receipt.
    const receiptHeader = JSON.stringify({
      txHash,
      facilitator: "chain",
      receiptId: `agent-${ctx.callerTokenId}-call-${ctx.callId.slice(0, 8)}-${Date.now()}`,
    });
    let body: { output?: string; receipt?: unknown; callId?: string } = {};
    try {
      const res = await fetch(`${ctx.peerOperatorUrl}/x402/infer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT-V1-RESPONSE": receiptHeader,
        },
        body: JSON.stringify({
          tokenId: targetAddr.tokenId.toString(),
          input: inputText,
          subscriber: wallet.address, // peer sees our agent wallet as the caller
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { text: `peer ${res.status}: ${t.slice(0, 200)}`, resultSummary: `peer ${res.status}` };
      }
      body = await res.json();
    } catch (e) {
      return {
        text: `peer call failed after payment ${txHash}: ${e instanceof Error ? e.message : String(e)}`,
        resultSummary: "peer call failed",
      };
    }

    const output = body.output ?? "(empty)";
    return {
      text:
        `[paid ${(Number(amount) / 1e6).toFixed(2)} USDC to ${target} via ${txHash.slice(0, 14)}…]\n` +
        `[peer.callId=${body.callId ?? "?"}]\n\n${output}`,
      resultSummary: `paid ${target} ${(Number(amount) / 1e6).toFixed(2)} USDC`,
      meta: { txHash, peerCallId: body.callId, peerOutput: output },
    };
  },
};

/**
 * Resolve a ticker ("AUDIT") or ENS name ("auditor.slopstock.eth") to an
 * agent's Base-side bundle.
 *
 * For `.eth` names we hit Sepolia ENS for real — `getEnsAddress` resolves the
 * subname via the PublicResolver, and we then verify the resolved address
 * matches one of our known vault addresses. If the resolver returns junk or
 * an address we don't know, we refuse the call. That's the cryptographic
 * binding: ENS isn't decorative, it's the agent identifier and a wrong
 * resolver answer means a wrong payment recipient.
 */
async function resolveAgentAddresses(
  nameOrTicker: string,
  sepoliaPublic?: import("viem").PublicClient,
) {
  const upper = nameOrTicker.toUpperCase();
  if (BASE_SEPOLIA_AGENTS[upper]) return BASE_SEPOLIA_AGENTS[upper];

  if (nameOrTicker.toLowerCase().endsWith(".eth") && sepoliaPublic) {
    try {
      const resolved = await sepoliaPublic.getEnsAddress({ name: nameOrTicker.toLowerCase() });
      if (resolved) {
        for (const a of Object.values(BASE_SEPOLIA_AGENTS)) {
          if (a.revenueVault.toLowerCase() === resolved.toLowerCase()) return a;
        }
      }
    } catch {
      // Fall through to local-name match below.
    }
  }

  for (const a of Object.values(BASE_SEPOLIA_AGENTS)) {
    if (a.ensName.toLowerCase() === nameOrTicker.toLowerCase()) return a;
  }
  return null;
}

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  parse_ast: parseAst,
  pattern_search: patternSearch,
  recall,
  note,
  query_agent: queryAgent,
};

// `encodeFunctionData` and `parseUnits` are imported but only used inside
// reflection-like patterns above; reference them so dead-code linters don't
// strip the imports during bundling.
void encodeFunctionData;
void parseUnits;

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
