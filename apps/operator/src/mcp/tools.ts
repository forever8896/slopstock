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
 *
 * Tool schemas are JSON Schema (the MCP convention). We validate with zod
 * server-side because the SDK doesn't enforce the JSON Schema for us.
 */

import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Clients } from "../chain/clients.ts";
import type { ComputeClient } from "../compute/client.ts";
import type { ReceiptSigner } from "../compute/receipt.ts";
import type { OperatorConfig } from "../config.ts";
import { findReceipt, recordReceipt } from "../store/receipts.ts";
import { agentNftAbi } from "../chain/abis.ts";
import { HERO_AGENT } from "@stratum/shared";

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
  compute: ComputeClient;
  receiptSigner: ReceiptSigner;
  agentNftAddress: `0x${string}` | undefined;
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

async function handleProfile(args: z.infer<typeof profileInput>, _deps: ToolDeps) {
  const tokenId = _parseTokenId(args.tokenId);
  // For demo we hard-code the hero agent profile; once AgentRegistry is deployed
  // we read shareToken/vault from `info(tokenId)` on-chain.
  return {
    tokenId: tokenId.toString(),
    name: HERO_AGENT.ens,
    ticker: HERO_AGENT.ticker,
    description: "Sealed Solidity audit agent.",
    modelBase: "qwen2.5-coder-32b",
    pricing: { perCall: "1000000", asset: "USDC.base", currency: "USDC", perCallHuman: "$1.00" },
    expectedTeeMeasurement: "0x9a3f0000000000000000000000000000000000000000000000000000000000ff",
  };
}

async function handleQuote(args: z.infer<typeof quoteInput>, _deps: ToolDeps) {
  const tokenId = _parseTokenId(args.tokenId);
  return {
    tokenId: tokenId.toString(),
    price: { amount: "1000000", asset: "USDC.base" },
    paymentEndpoint: "/x402/infer",
    paymentMethods: ["x402"],
    expiresIn: 600,
  };
}

async function handleInfer(args: z.infer<typeof inferInput>, deps: ToolDeps) {
  const tokenId = _parseTokenId(args.tokenId);
  const subscriber = args.subscriber as `0x${string}`;

  // Onchain authorization gate. Skipped if AgentNFT address is unconfigured
  // (typical in DEMO_MODE without a deployed iNFT).
  if (deps.agentNftAddress) {
    const authorized = await deps.clients.zgPublic.readContract({
      address: deps.agentNftAddress,
      abi: agentNftAbi,
      functionName: "isAuthorized",
      args: [tokenId, subscriber],
    });
    if (!authorized) throw new Error("subscriber not authorized — pay via x402 first");
  }

  const callId = crypto.randomUUID();
  const compute = await deps.compute.runInference({
    tokenId,
    subscriber,
    input: args.input,
    paymentReceiptId: args.paymentReceipt,
  });

  const receipt = await deps.receiptSigner.build(
    compute,
    { tokenId, subscriber, paymentReceiptId: args.paymentReceipt },
    callId,
  );
  recordReceipt(receipt);

  return {
    callId,
    output: compute.output,
    receipt,
  };
}

async function handleAttestation(args: z.infer<typeof attestationInput>, _deps: ToolDeps) {
  const r = findReceipt(args.callId);
  if (!r) throw new Error(`no receipt for callId ${args.callId}`);
  return r;
}
