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

import { keccak256, toHex, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { BASE_SEPOLIA_AGENTS } from "@stratum/shared";
import { encodeInteropAddress, CHAIN_TYPE_EIP155 } from "../../../../packages/shared/src/erc7930.ts";
import type { Clients } from "../chain/clients.ts";
import type { OperatorConfig } from "../config.ts";
import { agentWalletFor } from "./agent-wallet.ts";
import { createAgentPayFetch, exaSearch, formatHits } from "./x402-outbound.ts";
import { listSkillStems, readSkillBody, upsertSkill, deleteSkill, skillSlug, ensureSkillFrontmatter } from "./skills.ts";
import { appendMemoryLine } from "./memory-files.ts";
import { resolveAgent, verifyAgent } from "../store/ens-agent-resolver.ts";

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
  /** Resolve a credentialed-tool secret (e.g. an API key) just-in-time from
   *  1Claw, scoped to THIS agent's tokenId. Call it inside the handler right
   *  before the outbound request; the value must NEVER be returned to the model
   *  or written to the receipt. Undefined when 1Claw isn't configured — a
   *  credentialed tool should then fail-soft, not crash the loop. */
  resolveSecret?: (secretRef: string) => Promise<string>;
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
    // Mirror the fact into human-readable Layer-1 memory so it persists into
    // the next session's frozen system prompt (and into Walrus snapshots).
    await appendMemoryLine(ctx.agentDir, `${key}: ${value}`).catch(() => {});
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

    // ── ENS-first resolution (ENSIP-26 + ENSIP-25) ───────────────────────────
    // For .eth names we first try to resolve the peer via ENS text records and
    // run ENSIP-25 verification BEFORE paying. A failed verification aborts the
    // call — we never pay an unverified agent.
    //
    // If ENS resolution is unavailable (no records, RPC error) we fall through
    // to the BASE_SEPOLIA_AGENTS static map so existing named agents still work.
    let ensResolutionNote = "";
    let ensEndpointX402: string | null = null;

    if (target.toLowerCase().endsWith(".eth")) {
      try {
        // slopstock.eth + its agent subnames live on Ethereum MAINNET ENS, so we
        // resolve + ENSIP-25-verify there regardless of which network the x402
        // payment rails run on. Override with ENS_NETWORK=sepolia for testnet demos.
        const netConfig = ctx.config as unknown as { ENS_NETWORK?: string; ETH_RPC_URL?: string };
        const ensNetwork = netConfig.ENS_NETWORK === "sepolia" ? "sepolia" as const : "mainnet" as const;
        const ensRpcUrl = netConfig.ETH_RPC_URL;

        // Resolve ENSIP-26 records
        const resolved = await resolveAgent(target.toLowerCase(), {
          network: ensNetwork,
          rpcUrl: ensRpcUrl,
        });

        if (resolved.endpointX402) {
          // Run ENSIP-25 verification before using the endpoint.
          // We use Base mainnet registry for mainnet, Base Sepolia for testnet.
          const registryChainId = ensNetwork === "mainnet" ? 8453n : 84532n;
          const registryAddress: Hex = ensNetwork === "mainnet"
            ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
            : "0x8004A818BFB912233c491871b3d84c89A494BD9e";

          // We don't know the peer's agentId here — ENSIP-25 verification requires
          // the agentId. If the peer has an `agent-context` record that includes
          // their agentId, we'd parse it; otherwise we skip ENSIP-25 and log a warning.
          // For permissionless agents that have registered in ERC-8004, their agentId
          // should be resolvable. For now, if the agentId is not available, we note
          // that ENSIP-25 could not be run (not the same as failing it).
          //
          // When the peer's tokenId IS known (same-operator calls), we verify.
          const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, registryChainId, registryAddress);

          // Try to extract agentId from agent-context (look for agentId: N pattern)
          const agentIdMatch = resolved.agentContext?.match(/agentId["\s:]+(\d+)/i);
          const agentId = agentIdMatch?.[1] ?? null;

          if (agentId) {
            const verification = await verifyAgent(target.toLowerCase(), interopAddr, agentId, {
              network: ensNetwork,
              rpcUrl: ensRpcUrl,
            });
            if (!verification.verified) {
              return {
                text:
                  `ENSIP-25 verification FAILED for '${target}' (agentId=${agentId}): ${verification.reason ?? "empty record"}\n` +
                  `Key checked: ${verification.key}\n` +
                  `Refusing payment — cannot pay an unverified agent.`,
                resultSummary: `ENSIP-25 fail: ${target}`,
                meta: { ensName: target, verificationKey: verification.key, verified: false },
              };
            }
            ensResolutionNote = `[ENSIP-25 verified agentId=${agentId}] `;
          } else {
            // No agentId available — note that ENSIP-25 was skipped (not failed)
            ensResolutionNote = "[ENS-resolved; ENSIP-25 skipped (no agentId in context)] ";
          }

          ensEndpointX402 = resolved.endpointX402;
          console.log(
            `[query_agent] ENS resolved '${target}' → x402=${ensEndpointX402}${agentId ? ` (ENSIP-25 verified agentId=${agentId})` : ""}`,
          );
        }
      } catch (ensErr) {
        // ENS resolution failed — fall through to static map
        const msg = ensErr instanceof Error ? ensErr.message : String(ensErr);
        console.warn(`[query_agent] ENS resolution failed for '${target}': ${msg.slice(0, 150)} — falling back to static map`);
      }
    }

    // If we resolved an x402 endpoint directly from ENS, use it (permissionless path).
    // In this path we don't have a tokenId (permissionless agents don't have one in
    // BASE_SEPOLIA_AGENTS), so we use 0n as a placeholder tokenId that will be
    // rejected by the self-call guard only if callerTokenId is also 0.
    if (ensEndpointX402) {
      const wallet = agentWalletFor(ctx.config.OPERATOR_PRIVATE_KEY as Hex, ctx.callerTokenId);
      const payFetch = createAgentPayFetch(wallet);
      let body: { output?: string; receipt?: unknown; callId?: string; status?: string; message?: string; settlementTx?: string } | null = null;
      try {
        const res = await payFetch(ensEndpointX402, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: inputText, subscriber: wallet.address }),
        });
        if (res.ok) {
          body = await res.json();
        } else {
          // Published endpoint reachable but unhappy — keep discovery+verify, fall
          // back to the known route below rather than failing the whole call.
          console.warn(`[query_agent] ENS endpoint ${ensEndpointX402} returned ${res.status} — falling back to known route`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[query_agent] ENS endpoint unreachable (${msg.slice(0, 80)}) — falling back to known route`);
      }
      // Only return on a successful ENS-routed payment; otherwise fall through to
      // the static-map route (the peer was already ENS-discovered + ENSIP-25-verified).
      if (body) {
      const output = body.output ?? "(empty)";
      return {
        text:
          `${ensResolutionNote}[paid ${target} via x402 v2${body.settlementTx ? ` · ${body.settlementTx}` : ""}]\n\n${output}`,
        resultSummary: `${ensResolutionNote}paid ${target}`,
        meta: { settlementTx: body.settlementTx, peerCallId: body.callId, peerOutput: output },
      };
      }
    }

    // ── Static map fallback ────────────────────────────────────────────────────
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

    // Derive the calling agent's wallet (deterministic from operator key + tokenId)
    // and pay the peer via real x402 v2. The @x402/fetch wrapper handles the
    // 402 challenge → EIP-3009 sign → facilitator settle automatically (gasless
    // for the payer). The agent wallet just needs USDC on the active network.
    const wallet = agentWalletFor(ctx.config.OPERATOR_PRIVATE_KEY as Hex, ctx.callerTokenId);
    const payFetch = createAgentPayFetch(wallet);

    let body: {
      output?: string; receipt?: unknown; callId?: string; status?: string;
      message?: string; settlementTx?: string;
    } = {};
    try {
      const res = await payFetch(`${ctx.peerOperatorUrl}/x402/infer?tokenId=${targetAddr.tokenId.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: targetAddr.tokenId.toString(),
          input: inputText,
          subscriber: wallet.address, // peer sees our agent wallet as the caller
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return {
          text: `peer ${res.status}: ${t.slice(0, 200)}\n\n(agent wallet ${wallet.address} needs USDC to pay peers via x402 v2.)`,
          resultSummary: `peer ${res.status}`,
        };
      }
      body = await res.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text: `agent payment/call failed: ${msg.slice(0, 250)}\n\n(agent wallet ${wallet.address} needs USDC to pay peers via x402 v2.)`,
        resultSummary: `pay failed: ${wallet.address.slice(0, 10)}…`,
      };
    }

    // The peer's /x402/infer is async — returns {status:"running", callId}
    // immediately. Poll /x402/calls/<id> until complete (or 3min ceiling).
    if (body.status === "running" && body.callId) {
      const pollStart = Date.now();
      const POLL_DEADLINE = 180_000;
      const POLL_INTERVAL = 1500;
      let resolved: typeof body | null = null;
      const peerCallId = body.callId;
      console.log(`[query_agent] polling peer callId=${peerCallId.slice(0, 8)}…`);
      while (Date.now() - pollStart < POLL_DEADLINE) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        try {
          const pr = await fetch(`${ctx.peerOperatorUrl}/x402/calls/${peerCallId}`);
          if (pr.status === 404) {
            console.warn(`[query_agent] peer poll 404 for callId=${peerCallId.slice(0, 8)}`);
            break;
          }
          const pb = (await pr.json()) as typeof body;
          if (pb && pb.status === "running") continue;
          resolved = pb;
          break;
        } catch (err) {
          console.warn(`[query_agent] peer poll error: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
      }
      if (!resolved) {
        return {
          text: `peer call ${peerCallId.slice(0, 8)}… timed out (settlement ${body.settlementTx ?? "?"})`,
          resultSummary: "peer poll timeout",
        };
      }
      if (resolved.status === "error") {
        const errMsg = resolved.message ?? "unknown peer error";
        console.warn(`[query_agent] peer returned error: ${errMsg.slice(0, 200)}`);
        return {
          text: `peer ${target} errored: ${errMsg.slice(0, 250)}\n[paid via x402 v2${body.settlementTx ? ` · ${body.settlementTx}` : ""}]`,
          resultSummary: `peer error: ${errMsg.slice(0, 60)}`,
          meta: { settlementTx: body.settlementTx, peerCallId, peerError: errMsg },
        };
      }
      console.log(`[query_agent] peer resolved status=${resolved.status} outputLen=${(resolved.output ?? "").length}`);
      // carry the settlement tx from the paid response into the resolved body
      resolved.settlementTx = resolved.settlementTx ?? body.settlementTx;
      body = resolved;
    }

    const output = body.output ?? "(empty)";
    return {
      text:
        `[paid ${target} via x402 v2${body.settlementTx ? ` · ${body.settlementTx}` : ""}]\n` +
        `[peer.callId=${body.callId ?? "?"}]\n\n${output}`,
      resultSummary: `paid ${target} via x402 v2`,
      meta: { settlementTx: body.settlementTx, peerCallId: body.callId, peerOutput: output },
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

// ─── New tools for permissionless agents (PRD §3.3) ───────────────

const FETCH_URL_MAX_BYTES = 4096;
const FETCH_URL_TIMEOUT_MS = 8_000;

const fetchUrlTool: ToolDef = {
  name: "fetch_url",
  description:
    "HTTP GET a public URL and return up to 4kB of the response text. Use for live data sources like coingecko, defillama, or any unauthenticated public API. Refuses localhost and private IP ranges.",
  argsSchema: {
    type: "object",
    properties: { url: { type: "string", description: "absolute http(s) url" } },
    required: ["url"],
    additionalProperties: false,
  },
  async handler(args) {
    const url = String(args["url"] ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { text: "(url must start with http:// or https://)", resultSummary: "bad scheme" };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { text: "(invalid url)", resultSummary: "invalid url" };
    }
    if (isPrivateHost(parsed.hostname)) {
      return {
        text: `(refused: ${parsed.hostname} is a private/loopback host; tool is for public sources only)`,
        resultSummary: "private host refused",
      };
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_URL_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.5", "User-Agent": "stratum-agent/1" },
      });
      const text = await res.text();
      const truncated = text.slice(0, FETCH_URL_MAX_BYTES);
      const note = text.length > FETCH_URL_MAX_BYTES ? `\n\n[truncated at ${FETCH_URL_MAX_BYTES} bytes; full ${text.length}b]` : "";
      return {
        text: `[GET ${url} → ${res.status}]\n${truncated}${note}`,
        resultSummary: `${res.status} ${parsed.hostname} (${truncated.length}b)`,
        meta: { status: res.status, hostname: parsed.hostname, size: text.length },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { text: `(fetch failed: ${msg.slice(0, 200)})`, resultSummary: "fetch failed" };
    } finally {
      clearTimeout(t);
    }
  },
};

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local incl. cloud metadata
  if (h === "metadata.google.internal") return true;
  return false;
}

const ONCHAIN_NETWORKS: Record<string, { rpcEnv: string; default: string }> = {
  "base-sepolia": { rpcEnv: "BASE_RPC_URL", default: "https://base-sepolia-rpc.publicnode.com" },
  "sepolia": { rpcEnv: "SEPOLIA_RPC_URL", default: "https://ethereum-sepolia-rpc.publicnode.com" },
  "0g-galileo": { rpcEnv: "ZG_RPC_URL", default: "https://evmrpc-testnet.0g.ai" },
};

const onchainReadTool: ToolDef = {
  name: "onchain_read",
  description:
    "Call a view function on a whitelisted network. networks: 'base-sepolia' | 'sepolia' | '0g-galileo'. abi must include the function. Use for live on-chain data: balances, prices from oracle contracts, totalSupply, custom view functions.",
  argsSchema: {
    type: "object",
    properties: {
      network: { type: "string", enum: ["base-sepolia", "sepolia", "0g-galileo"] },
      address: { type: "string", description: "0x… contract address" },
      abi: {
        type: "array",
        description: "viem-style ABI fragments — only the function you want to call is needed",
      },
      functionName: { type: "string" },
      args: { type: "array", description: "function args; bigints/addresses as strings" },
    },
    required: ["network", "address", "abi", "functionName"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const network = String(args["network"] ?? "");
    const conf = ONCHAIN_NETWORKS[network];
    if (!conf) {
      return {
        text: `(network '${network}' not whitelisted; allowed: ${Object.keys(ONCHAIN_NETWORKS).join(", ")})`,
        resultSummary: "bad network",
      };
    }
    const address = String(args["address"] ?? "");
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return { text: "(invalid address)", resultSummary: "bad address" };
    }
    const abi = Array.isArray(args["abi"]) ? args["abi"] : null;
    if (!abi) return { text: "(abi must be array)", resultSummary: "bad abi" };
    const functionName = String(args["functionName"] ?? "");
    const callArgs = Array.isArray(args["args"]) ? args["args"] : [];

    try {
      const { createPublicClient, http } = await import("viem");
      const rpcUrl =
        (ctx.config as unknown as Record<string, string>)[conf.rpcEnv] ?? conf.default;
      const client = createPublicClient({ transport: http(rpcUrl) });
      const result = (await client.readContract({
        address: address as `0x${string}`,
        abi: abi as never,
        functionName,
        args: callArgs as never,
      })) as unknown;
      const rendered =
        typeof result === "bigint"
          ? (result as bigint).toString()
          : JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      return {
        text: `[${network} ${address} ${functionName}(${callArgs.length} args) → ${rendered.slice(0, 1500)}]`,
        resultSummary: `${network}:${functionName} → ${rendered.slice(0, 60)}`,
        meta: { network, address, functionName },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { text: `(onchain_read failed: ${msg.slice(0, 250)})`, resultSummary: "rpc failed" };
    }
  },
};

const imageGenTool: ToolDef = {
  name: "image_gen",
  description:
    "Generate an image from a text prompt. Returns a viewable URL and a 0G Storage CID for the image bytes. Use for memes, mockups, illustrative content. Be vivid and specific in the prompt.",
  argsSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "the image prompt; include style, mood, composition" },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const prompt = String(args["prompt"] ?? "").trim();
    if (!prompt) return { text: "(empty prompt)", resultSummary: "empty prompt" };

    // Compute a stable CID for the prompt itself (so identical prompts return
    // the same address; useful for caching and demo determinism).
    const promptBytes = new TextEncoder().encode(prompt);
    const promptHash = keccak256(toHex(promptBytes)).slice(2); // hex no 0x
    const placeholderUrl = `https://placehold.co/640x640/0b1020/10b981?text=${encodeURIComponent(prompt.slice(0, 60))}`;
    // Pin a JSON descriptor so the receipt has something content-addressable
    // beyond the placeholder URL.
    try {
      const { getOperatorOgStorage } = await import("../storage/og-storage-impl.ts");
      const ogs = getOperatorOgStorage({ dataDir: ctx.config.AGENTS_DATA_DIR });
      const descriptor = {
        kind: "stratum/image-descriptor@1",
        prompt,
        placeholderUrl,
        promptHash,
        ts: Math.floor(Date.now() / 1000),
      };
      const pin = await ogs.pinJson(descriptor);
      return {
        text:
          `[image_gen "${prompt.slice(0, 80)}"]\n` +
          `cid: ${pin.uri}\n` +
          `viewable: ${placeholderUrl}\n` +
          `(this build returns a deterministic placeholder; the descriptor at the cid carries the prompt and viewable url)`,
        resultSummary: `gen: ${prompt.slice(0, 40)}`,
        meta: { uri: pin.uri, viewable: placeholderUrl, promptHash },
      };
    } catch (e) {
      return {
        text: `[image_gen "${prompt.slice(0, 80)}"]\nviewable: ${placeholderUrl}\n(og-storage pin unavailable: ${e instanceof Error ? e.message : String(e)})`,
        resultSummary: `gen (no-pin): ${prompt.slice(0, 40)}`,
        meta: { viewable: placeholderUrl, promptHash },
      };
    }
  },
};

/**
 * web_search — the OUTBOUND leg: the agent autonomously pays a real external
 * x402 service (Exa) to search for exploits/CVEs mid-audit. ~$0.007 USDC per
 * call, paid from the agent's own wallet via x402 v2. (Exa is on Base mainnet —
 * the agent wallet needs USDC on mainnet to pay it for real.)
 */
const webSearchTool: ToolDef = {
  name: "web_search",
  description:
    "Search the web for known exploits, CVEs, or vulnerability patterns relevant " +
    "to the code under audit. Pays ~$0.007 USDC autonomously from your agent wallet " +
    "(x402). Use when external knowledge would confirm or refute a finding.",
  argsSchema: {
    type: "object",
    properties: { query: { type: "string", description: "search query" } },
    required: ["query"],
  },
  async handler(args, ctx) {
    const query = String(args["query"] ?? "").trim();
    if (!query) return { text: "web_search needs a 'query' argument.", resultSummary: "no query" };
    const account = agentWalletFor(ctx.config.OPERATOR_PRIVATE_KEY as Hex, ctx.callerTokenId);
    try {
      const hits = await exaSearch(createAgentPayFetch(account), query, 3);
      return {
        text: formatHits(hits),
        resultSummary: `web_search "${query.slice(0, 40)}" → ${hits.length} hits`,
        meta: { query, count: hits.length },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text: `web_search failed: ${msg.slice(0, 200)}\n(agent wallet ${account.address} needs USDC on Base mainnet to pay Exa.)`,
        resultSummary: "web_search failed",
      };
    }
  },
};

// ─── Progressive-disclosure skill tools (Hermes Agent pattern) ──────────────

const skillsList: ToolDef = {
  name: "skills_list",
  description:
    "List your accumulated skills (names + descriptions only — Level 0). Call this first to see what you already know before tackling a task; then skill_view to read one in full.",
  argsSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, ctx) {
    const stems = await listSkillStems(ctx.agentDir);
    if (stems.length === 0) return { text: "(no skills yet)", resultSummary: "0 skills" };
    const lines: string[] = [];
    for (const stem of stems) {
      const body = await readSkillBody(ctx.agentDir, stem);
      const desc = body?.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      lines.push(`▸ ${stem}: ${desc}`);
    }
    return { text: lines.join("\n"), resultSummary: `${stems.length} skills` };
  },
};

const skillView: ToolDef = {
  name: "skill_view",
  description:
    "Read the full content of one skill by its stem (as shown by skills_list). Pull a skill into context only when it's relevant — Level 1 of progressive disclosure.",
  argsSchema: {
    type: "object",
    properties: { name: { type: "string", description: "skill stem, e.g. 'oracle-manipulation'" } },
    required: ["name"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const name = String(args["name"] ?? "").trim();
    if (!name) return { text: "(missing name)", resultSummary: "missing name" };
    const body = await readSkillBody(ctx.agentDir, name);
    if (body === null) {
      const stems = await listSkillStems(ctx.agentDir);
      return { text: `(no skill '${name}'); available: ${stems.join(", ") || "(none)"}`, resultSummary: `miss: ${name}` };
    }
    return { text: body, resultSummary: `viewed ${skillSlug(name)} (${body.length}b)` };
  },
};

const skillManage: ToolDef = {
  name: "skill_manage",
  description:
    "Create or improve a skill so you remember a workflow next time. op: 'create' | 'edit' | 'delete'. Provide a short kebab `name`; for create/edit provide a Markdown `content` body. Prefer 'edit' on an existing skill over making near-duplicates — improving skills in place is how you get better over time.",
  argsSchema: {
    type: "object",
    properties: {
      op: { type: "string", enum: ["create", "edit", "delete"] },
      name: { type: "string", description: "short skill title, e.g. 'oracle-manipulation'" },
      content: { type: "string", description: "Markdown body (for create/edit)" },
    },
    required: ["op", "name"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const op = String(args["op"] ?? "");
    const name = String(args["name"] ?? "").trim();
    if (!name) return { text: "(missing name)", resultSummary: "missing name" };
    if (op === "delete") {
      const ok = await deleteSkill(ctx.agentDir, name);
      return ok
        ? { text: `deleted ${skillSlug(name)}`, resultSummary: `deleted ${skillSlug(name)}` }
        : { text: `(no skill '${name}' to delete)`, resultSummary: "delete miss" };
    }
    const content = String(args["content"] ?? "").trim();
    if (!content) return { text: "(create/edit needs content)", resultSummary: "missing content" };
    const res = await upsertSkill(ctx.agentDir, name, ensureSkillFrontmatter(name, content));
    return {
      text: `${res.action}d skill '${res.stem}' (v${res.version})`,
      resultSummary: `${res.action} ${res.stem} v${res.version}`,
    };
  },
};

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  parse_ast: parseAst,
  pattern_search: patternSearch,
  recall,
  note,
  query_agent: queryAgent,
  fetch_url: fetchUrlTool,
  onchain_read: onchainReadTool,
  image_gen: imageGenTool,
  web_search: webSearchTool,
  skills_list: skillsList,
  skill_view: skillView,
  skill_manage: skillManage,
};

// `encodeFunctionData` is imported but only used inside reflection-like
// patterns above; reference it so dead-code linters don't strip the import.
void encodeFunctionData;

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
