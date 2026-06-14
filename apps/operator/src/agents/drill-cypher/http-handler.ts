/**
 * Drill-Cypher step 5 — x402-gated HTTP handler for POST /run/drill-cypher.
 *
 * Price: 3.00 USDC. Validates `opps` first (400) so no 0G/ElevenLabs spend on a
 * bad request. Prepaid model: gate → settle → run (don't charge for failed runs).
 * The ElevenLabs credential is resolved inside the run via 1Claw — never here.
 */

import type { NetworkConfig } from "@stratum/shared";
import {
  buildAgentPaymentRequirements,
  requirePayment,
  settlePayment,
  settleResponseHeader,
  type AgentPaymentOpts,
} from "../../http/x402-v2.ts";
import type { FacilitatorClient } from "@x402/core/server";
import type { OperatorConfig } from "../../config.ts";
import { runDrillCypher, DRILL_CYPHER_TOKEN_ID, type DrillResult } from "./run.ts";
import type { DrillStyle } from "./generate-lyrics.ts";

/** Price: 3.00 USDC */
export const DRILL_CYPHER_PRICE_SMALLEST = "3000000";
export const DRILL_CYPHER_PRICE_HUMAN = "$3.00";

function getDrillCypherVault(): `0x${string}` {
  return (
    (process.env["DRILL_CYPHER_VAULT_ADDRESS"] as `0x${string}` | undefined) ??
    "0x0000000000000000000000000000000000000000"
  );
}

export interface DrillCypherHandlerDeps {
  net: NetworkConfig;
  facilitator: FacilitatorClient;
  /** Operator config — needed so the run can resolve the ElevenLabs key via 1Claw. */
  config?: OperatorConfig;
  tokenId?: bigint;
}

export async function handleDrillCypher(req: Request, deps: DrillCypherHandlerDeps): Promise<Response> {
  const resource = req.url;
  const vault = getDrillCypherVault();

  const paymentOpts: AgentPaymentOpts = {
    priceSmallest: DRILL_CYPHER_PRICE_SMALLEST,
    payTo: vault,
    resource,
    description: "Slopstock drill-cypher agent — a drill track roasting your opps, stored on Walrus",
  };
  const requirements = buildAgentPaymentRequirements(deps.net, paymentOpts);

  // Parse + validate FIRST — reject bad input before any payment/compute.
  let body: { opps?: string[]; style?: string; extra_bars?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.opps) || body.opps.length === 0 || !body.opps.every((o) => typeof o === "string" && o.trim())) {
    return json({ error: "opps is required (a non-empty array of names/handles to roast)" }, { status: 400 });
  }
  if (body.style && body.style !== "uk-drill" && body.style !== "ny-drill") {
    return json({ error: "style must be 'uk-drill' or 'ny-drill'" }, { status: 400 });
  }

  // x402 gate.
  const gate = await requirePayment({
    paymentHeader: req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT"),
    resource,
    requirements,
    facilitator: deps.facilitator,
  });
  if (!gate.ok) return withCors(gate.response);

  // Settle before running (prepaid-API model).
  const settle = await settlePayment({ facilitator: deps.facilitator, payload: gate.payload, requirements });
  if (!settle.success) {
    return json({ error: `payment settlement failed: ${settle.errorReason ?? "unknown"}` }, { status: 402 });
  }

  let result: DrillResult;
  try {
    result = await runDrillCypher(
      { opps: body.opps, style: (body.style as DrillStyle | undefined) ?? "ny-drill", extraBars: body.extra_bars },
      { config: deps.config, tokenId: deps.tokenId ?? DRILL_CYPHER_TOKEN_ID },
    );
  } catch (err) {
    return json(
      { error: `agent error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: { "PAYMENT-RESPONSE": settleResponseHeader(settle) } },
    );
  }

  return json(
    {
      ok: true,
      lyrics: result.lyrics,
      stylePrompt: result.stylePrompt,
      blobId: result.blobId,
      aggregatorUrl: result.aggregatorUrl,
      bars: result.bars,
      settlementTx: settle.transaction,
    },
    { headers: { "PAYMENT-RESPONSE": settleResponseHeader(settle) } },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
};

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, init?: ResponseInit): Response {
  return withCors(
    new Response(JSON.stringify(body, null, 2), {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    }),
  );
}
