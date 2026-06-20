/**
 * Step 3 — 0G Compute inference loop for the demo-script agent.
 *
 * Uses the PROVEN 0G tool-calling path from smoke-0g-tool-calling.ts:
 *   - deepseek-v3 @ provider 0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0
 *   - OpenAI SDK with 0G broker headers
 *   - OpenAI-native tool_calls loop (not the Hermes JSON pattern)
 *
 * Caps: max 5 rounds, 45s wall-clock timeout.
 * Returns best-effort output with a note if loop times out or hits cap.
 */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] ??= "0";

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

import { DEMO_SCRIPT_SYSTEM_PROMPT } from "@stratum/shared";
import { digestRepo, estimateTokens } from "./repo-digest.ts";
import { READ_FILE_TOOL, handleReadFile } from "./tools.ts";
import { FETCH_BOUNTIES_TOOL, SEARCH_WINNERS_TOOL, fetchBounties, searchWinners } from "./ethglobal-skills.ts";

const MAINNET_RPC = "https://evmrpc.0g.ai";
const DEFAULT_PROVIDER = "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0" as `0x${string}`;
const MAX_ROUNDS = 5;
const WALL_CLOCK_MS = 45_000;

export interface DemoScriptInput {
  githubUrl: string;
  bounties?: string;   // e.g. "ENS, Walrus, Dynamic"
  vibe?: string;       // "technical" | "punchy" | "chaotic" | (default neutral)
  /** Override the 0G provider address (for testing with a different model). */
  providerAddress?: `0x${string}`;
}

export interface DemoScriptResult {
  script: string;
  toolCallsUsed: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Build a lazy 0G broker. Reused across calls within the same process.
 */
let _brokerPromise: Promise<{ broker: import("@0gfoundation/0g-compute-ts-sdk").ZGComputeNetworkBroker; wallet: ethers.Wallet }> | null = null;

function get0gBroker(): Promise<{ broker: import("@0gfoundation/0g-compute-ts-sdk").ZGComputeNetworkBroker; wallet: ethers.Wallet }> {
  if (_brokerPromise) return _brokerPromise;
  _brokerPromise = (async () => {
    const key = process.env["OPERATOR_PRIVATE_KEY"];
    if (!key) throw new Error("OPERATOR_PRIVATE_KEY env var is required for 0G Compute");
    const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
    const wallet = new ethers.Wallet(key, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    return { broker, wallet };
  })();
  return _brokerPromise;
}

/**
 * Main entry point: run the demo-script agent end-to-end.
 */
export async function runDemoScript(input: DemoScriptInput): Promise<DemoScriptResult> {
  const providerAddress = input.providerAddress ?? DEFAULT_PROVIDER;
  const wallClockDeadline = Date.now() + WALL_CLOCK_MS;

  // ── Step 1: Deterministic repo digest ─────────────────────────────────
  const digest = await digestRepo(input.githubUrl);
  const tokenEst = estimateTokens(digest);
  const digestSummary = buildDigestSummary(digest);

  // ── Step 2: 0G broker setup ────────────────────────────────────────────
  const { broker } = await get0gBroker();

  // Acknowledge provider (idempotent, safe to call repeatedly)
  try { await broker.inference.acknowledgeProviderSigner(providerAddress); } catch { /* already acked */ }

  const meta = await broker.inference.getServiceMetadata(providerAddress);

  // ── Step 3: Build system prompt + initial user message ─────────────────
  const vibeInstruction = input.vibe
    ? `\n\nVIBE: The caller requested "${input.vibe}" tone — apply this throughout.`
    : "";
  const bountiesInstruction = input.bounties
    ? `\n\nTARGET BOUNTIES: ${input.bounties} — prioritise callouts for these sponsors.`
    : "";

  const systemContent =
    DEMO_SCRIPT_SYSTEM_PROMPT +
    vibeInstruction +
    bountiesInstruction +
    `\n\n## REPO DIGEST\n\n${digestSummary}\n\nToken estimate: ${tokenEst}`;

  const tools: ChatCompletionTool[] = [
    READ_FILE_TOOL as ChatCompletionTool,
    FETCH_BOUNTIES_TOOL as ChatCompletionTool,
    SEARCH_WINNERS_TOOL as ChatCompletionTool,
  ];

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content:
        `Write a 90-second demo script for this project: ${input.githubUrl}\n\n` +
        `Use the read_file tool to examine the key files, ` +
        `and fetch_bounties/search_winners to ground your bounty callouts in real data. ` +
        `Produce the output in the exact markdown format specified in your role instructions.`,
    },
  ];

  let toolCallsUsed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalScript = "";

  // ── Step 4: Tool-calling loop ──────────────────────────────────────────
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (Date.now() > wallClockDeadline) {
      finalScript += `\n\n[timed out after ${round} rounds — best effort above]`;
      break;
    }

    // Fresh headers per round (each call needs a fresh signed challenge)
    const lastMsg = messages[messages.length - 1];
    const lastContent = lastMsg && "content" in lastMsg && typeof lastMsg.content === "string"
      ? lastMsg.content : "continue";
    const headers = await broker.inference.getRequestHeaders(providerAddress, lastContent.slice(0, 100));

    const client = new OpenAI({
      baseURL: meta.endpoint as string,
      apiKey: "",
      defaultHeaders: headers as unknown as Record<string, string>,
    });

    const res = (await client.chat.completions.create({
      model: meta.model as string,
      messages,
      tools,
      tool_choice: "auto",
      max_tokens: 2048,
    } as Parameters<typeof client.chat.completions.create>[0])) as ChatCompletion;

    const usage = res.usage;
    if (usage) {
      totalInputTokens += usage.prompt_tokens ?? 0;
      totalOutputTokens += usage.completion_tokens ?? 0;
    }

    const choice = res.choices?.[0];
    if (!choice) {
      finalScript = "[no response from model]";
      break;
    }

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    // If no tool calls or finish_reason is stop/length, treat as final answer
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop" || choice.finish_reason === "length") {
      finalScript = msg.content ?? "[empty response]";
      break;
    }

    // Process tool calls
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      toolCallsUsed++;
      let toolResult: string;

      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;

        if (tc.function.name === "read_file") {
          const path = String(args["path"] ?? "");
          toolResult = await handleReadFile(digest.owner, digest.repo, path, digest.sha);
        } else if (tc.function.name === "fetch_bounties") {
          const event = String(args["event"] ?? "");
          const sponsor = args["sponsor"] ? String(args["sponsor"]) : undefined;
          const bounties = await fetchBounties(event, sponsor);
          toolResult = bounties.length > 0
            ? JSON.stringify(bounties.slice(0, 5), null, 2)
            : "[]";
        } else if (tc.function.name === "search_winners") {
          const keyword = String(args["keyword"] ?? "");
          const event = args["event"] ? String(args["event"]) : undefined;
          const limit = args["limit"] ? Number(args["limit"]) : 5;
          const winners = await searchWinners(keyword, event, limit);
          toolResult = winners.length > 0
            ? JSON.stringify(winners.slice(0, limit), null, 2)
            : "[]";
        } else {
          toolResult = `[unknown tool: ${tc.function.name}]`;
        }
      } catch (err) {
        toolResult = `[tool error: ${err instanceof Error ? err.message : String(err)}]`;
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResult,
      });
    }
  }

  // If we exhausted rounds without a final message
  if (!finalScript) {
    finalScript = `[agent did not produce a final answer within ${MAX_ROUNDS} rounds]`;
  }

  return {
    script: finalScript,
    toolCallsUsed,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildDigestSummary(digest: import("./repo-digest.ts").RepoDigest): string {
  const treeLines = digest.tree.slice(0, 60).map((e) => `  ${e.path}`).join("\n");
  const truncatedNote = digest.tree.length > 60 ? `  ... (${digest.tree.length - 60} more files)` : "";

  const excerptSections = digest.excerpts
    .slice(0, 6)
    .map((e) => `### ${e.path}\n\`\`\`\n${e.snippet.slice(0, 600)}\n\`\`\``)
    .join("\n\n");

  return [
    `**Repository:** ${digest.owner}/${digest.repo} @ ${digest.sha.slice(0, 8)}`,
    "",
    "**File tree (first 60 entries):**",
    treeLines,
    truncatedNote,
    "",
    "**Key file excerpts:**",
    excerptSections,
  ].filter((x) => x !== "").join("\n");
}
