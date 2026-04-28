/**
 * MCP tool definitions and handlers for the Stratum operator.
 *
 * Spec: docs/06-axl-delivery.md §5. Four tools are exposed:
 *
 *   stratum.agent.profile       Free metadata read.
 *   stratum.agent.quote         Returns x402 payment instructions.
 *   stratum.agent.infer         The paid call. Verifies payment + on-chain
 *                                authorizeUsage, then runs Sealed Executor inference.
 *   stratum.agent.attestation   Returns a previously-emitted receipt by callId.
 */

import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Clients } from "../chain/clients.ts";
import type { ReceiptSigner } from "../compute/receipt.ts";
import type { OperatorConfig } from "../config.ts";
import type { AgentRuntime } from "../runtime/index.ts";
import { findReceipt, recordReceipt } from "../store/receipts.ts";
import { agentNftAbi, agentRegistryAbi } from "../chain/abis.ts";

// ─── Input schemas ───────────────────────────────────────────────────────────

const profileInput = z.object({ tokenId: z.union([z.number(), z.string()]) });
const quoteInput = z.object({ tokenId: z.union([z.number(), z.string()]) });
const inferInput = z.object({
  tokenId: z.union([z.number(), z.string()]),
  input: z.string().min(1),
  paymentReceipt: z.string().min(1),
  subscriber: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
const attestationInput = z.object({ callId: z.string().uuid() });

// ─── Per-ticker offchain pricing ─────────────────────────────────────────────
//
// Per-call price isn't on-chain (it's an operator policy decision). Track it
// here keyed by ticker. Web app's lib/agent-metadata.ts mirrors these values.

const PRICING_BY_TICKER: Record<string, { perCallSmallest: string; perCallHuman: string; modelBase: string; description: string }> = {
  AUDIT: {
    perCallSmallest: "1000000", // 1 USDC at 6 decimals
    perCallHuman: "$1.00",
    modelBase: "qwen2.5-coder-32b + audit-lora-v1 (sealed) — Hermes pattern",
    description:
      "Sealed Solidity audit agent. Pay 1 USDC, get a structured audit with TEE-attested provenance. Hermes-pattern runtime — tools, persistent memory, autonomous skill creation.",
  },
  MEMER: {
    perCallSmallest: "500000", // 0.5 USDC
    perCallHuman: "$0.50",
    modelBase: "qwen2.5-coder-7b (raw) — openai-compat runtime",
    description:
      "Quick ruggability check for meme-token contracts. Single-shot raw-model agent — no tools, no memory.",
  },
};

// ─── Tool list (descriptors) ─────────────────────────────────────────────────

export const tools: Tool[] = [
  {
    name: "stratum.agent.profile",
    description: "Return the agent's onchain profile (name, ticker, model, pricing). Free; no payment required.",
    inputSchema: {
      type: "object",
      properties: { tokenId: { type: ["integer", "string"], description: "Agent iNFT tokenId." } },
      required: ["tokenId"],
    },
  },
  {
    name: "stratum.agent.quote",
    description: "Return current per-call price + x402 payment instructions for an agent.",
    inputSchema: {
      type: "object",
      properties: { tokenId: { type: ["integer", "string"] } },
      required: ["tokenId"],
    },
  },
  {
    name: "stratum.agent.infer",
    description:
      "Run inference on a sealed agent. Requires a valid x402 payment receipt and an active onchain authorizeUsage grant.",
    inputSchema: {
      type: "object",
      properties: {
        tokenId: { type: ["integer", "string"] },
        input: { type: "string", description: "Subscriber-supplied input (e.g. Solidity source)." },
        paymentReceipt: { type: "string", description: "x402 payment receipt id." },
        subscriber: { type: "string", description: "Subscriber EVM address (0x…)." },
      },
      required: ["tokenId", "input", "paymentReceipt", "subscriber"],
    },
  },
  {
    name: "stratum.agent.attestation",
    description: "Fetch a past inference receipt (with TEE attestation) by callId.",
    inputSchema: {
      type: "object",
      properties: { callId: { type: "string", description: "uuidv4 receipt id." } },
      required: ["callId"],
    },
  },
];

// ─── Dispatch ───────────────────────────────────────────────────────────────

export interface ToolDeps {
  config: OperatorConfig;
  clients: Clients;
  runtime: AgentRuntime;
  receiptSigner: ReceiptSigner;
  agentNftAddress: `0x${string}`;
  agentRegistryAddress: `0x${string}`;
}

export async function dispatch(name: string, args: unknown, deps: ToolDeps): Promise<unknown> {
  switch (name) {
    case "stratum.agent.profile":
      return handleProfile(profileInput.parse(args), deps);
    case "stratum.agent.quote":
      return handleQuote(quoteInput.parse(args), deps);
    case "stratum.agent.infer":
      return handleInfer(inferInput.parse(args), deps);
    case "stratum.agent.attestation":
      return handleAttestation(attestationInput.parse(args), deps);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function _parseTokenId(raw: number | string): bigint {
  return typeof raw === "string" ? BigInt(raw) : BigInt(raw);
}

export async function handleProfile(args: z.infer<typeof profileInput>, deps: ToolDeps) {
  const tokenId = _parseTokenId(args.tokenId);

  const [info, ensName, measurement] = await Promise.all([
    deps.clients.zgPublic.readContract({
      address: deps.agentRegistryAddress,
      abi: agentRegistryAbi,
      functionName: "info",
      args: [tokenId],
    }),
    deps.clients.zgPublic.readContract({
      address: deps.agentNftAddress,
      abi: agentNftAbi,
      functionName: "ensName",
      args: [tokenId],
    }),
    deps.clients.zgPublic.readContract({
      address: deps.agentNftAddress,
      abi: agentNftAbi,
      functionName: "expectedMeasurement",
      args: [tokenId],
    }),
  ]);

  if (info.operator === "0x0000000000000000000000000000000000000000") {
    throw new Error(`tokenId ${tokenId} not registered`);
  }

  // Derive ticker from ENS subdomain (auditor.stratum.eth → AUDIT proxy via
  // PRICING_BY_TICKER). Falls back to UNKNOWN if no entry.
  const guessTicker = ensName.split(".")[0]?.toUpperCase() ?? "";
  const ticker =
    Object.keys(PRICING_BY_TICKER).find((t) => guessTicker.startsWith(t.slice(0, 4))) ??
    "AUDIT";
  const pricing = PRICING_BY_TICKER[ticker]!;

  return {
    tokenId: tokenId.toString(),
    name: ensName,
    ticker,
    description: pricing.description,
    modelBase: pricing.modelBase,
    pricing: {
      perCall: pricing.perCallSmallest,
      asset: "USDC.base",
      currency: "USDC",
      perCallHuman: pricing.perCallHuman,
    },
    operator: info.operator,
    shareToken: info.shareToken,
    vaultBase: info.vaultBase,
    ensName,
    expectedTeeMeasurement: measurement,
  };
}

export async function handleQuote(args: z.infer<typeof quoteInput>, deps: ToolDeps) {
  const profile = await handleProfile(args, deps);
  return {
    tokenId: profile.tokenId,
    price: { amount: profile.pricing.perCall, asset: profile.pricing.asset },
    paymentEndpoint: "/x402/infer",
    paymentMethods: ["x402"],
    expiresIn: 600,
    recipient: profile.vaultBase,
  };
}

async function handleInfer(args: z.infer<typeof inferInput>, deps: ToolDeps) {
  const tokenId = _parseTokenId(args.tokenId);
  const subscriber = args.subscriber as `0x${string}`;

  // Onchain authorization gate.
  const authorized = await deps.clients.zgPublic.readContract({
    address: deps.agentNftAddress,
    abi: agentNftAbi,
    functionName: "isAuthorized",
    args: [tokenId, subscriber],
  });
  if (!authorized) throw new Error("subscriber not authorized — pay via x402 first");

  const callId = crypto.randomUUID();
  await deps.runtime.load({ tokenId });
  const taskOutput = await deps.runtime.runTask({
    tokenId,
    subscriber,
    input: args.input,
    paymentReceiptId: args.paymentReceipt,
  });

  const receipt = await deps.receiptSigner.build(
    deps.runtime.kind,
    taskOutput,
    { tokenId, subscriber, paymentReceiptId: args.paymentReceipt },
    callId,
  );
  recordReceipt(receipt);

  return { callId, output: taskOutput.output, receipt };
}

async function handleAttestation(args: z.infer<typeof attestationInput>, _deps: ToolDeps) {
  const r = findReceipt(args.callId);
  if (!r) throw new Error(`no receipt for callId ${args.callId}`);
  return r;
}
