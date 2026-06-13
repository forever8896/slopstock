/**
 * Step 4 — x402-gated HTTP handler for POST /run/demo-script
 *
 * Price: 2.00 USDC (2_000_000 smallest USDC units)
 * Payment: x402 v2 via the existing facilitator from x402-v2.ts
 * Receipt: generated after run, stored in-process.
 *
 * Validates the GitHub URL first (throws 400) so no 0G credits are spent on
 * a bad request.
 */

import type { NetworkConfig } from "@stratum/shared";
import {
  buildAgentPaymentRequirements,
  build402,
  requirePayment,
  settlePayment,
  settleResponseHeader,
  type AgentPaymentOpts,
} from "../../http/x402-v2.ts";
import type { FacilitatorClient } from "@x402/core/server";
import { parseGithubUrl, RepoNotFoundError } from "./repo-digest.ts";
import { runDemoScript, type DemoScriptInput } from "./run.ts";

/** Price: 2.00 USDC */
export const DEMO_SCRIPT_PRICE_SMALLEST = "2000000";
export const DEMO_SCRIPT_PRICE_HUMAN = "$2.00";

/** The recipient vault for demo-script revenue. Can be configured by env. */
function getDemoScriptVault(): `0x${string}` {
  return (
    (process.env["DEMO_SCRIPT_VAULT_ADDRESS"] as `0x${string}` | undefined) ??
    "0x0000000000000000000000000000000000000000"
  );
}

export interface DemoScriptHandlerDeps {
  net: NetworkConfig;
  facilitator: FacilitatorClient;
}

/**
 * Handle POST /run/demo-script
 *
 * Request body:
 *   { github_url: string, bounties?: string, vibe?: string }
 *
 * Responses:
 *   400 — bad/missing github_url (before any 0G call)
 *   402 — no/invalid payment header
 *   200 — { ok: true, script: string, toolCallsUsed: number, ... }
 */
export async function handleDemoScript(
  req: Request,
  deps: DemoScriptHandlerDeps,
): Promise<Response> {
  const resource = req.url;
  const vault = getDemoScriptVault();

  const paymentOpts: AgentPaymentOpts = {
    priceSmallest: DEMO_SCRIPT_PRICE_SMALLEST,
    payTo: vault,
    resource,
    description: "Slopstock demo-script agent — 90s ETHGlobal demo script",
  };
  const requirements = buildAgentPaymentRequirements(deps.net, paymentOpts);

  // Parse and validate the request body FIRST — reject bad URLs before payment
  let body: { github_url?: string; bounties?: string; vibe?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.github_url) {
    return json({ error: "github_url is required" }, { status: 400 });
  }

  // Validate the URL format (throws RepoNotFoundError on bad format, not on 404)
  try {
    parseGithubUrl(body.github_url);
  } catch (err) {
    return json(
      { error: err instanceof RepoNotFoundError ? err.message : `invalid github_url: ${String(err)}` },
      { status: 400 },
    );
  }

  // x402 gate — returns 402 if no valid payment present
  const gate = await requirePayment({
    paymentHeader: req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT"),
    resource,
    requirements,
    facilitator: deps.facilitator,
  });
  if (!gate.ok) return withCors(gate.response);

  // Settle payment before running (prepaid-API model — do not charge for failed runs)
  const settle = await settlePayment({
    facilitator: deps.facilitator,
    payload: gate.payload,
    requirements,
  });
  if (!settle.success) {
    return json(
      { error: `payment settlement failed: ${settle.errorReason ?? "unknown"}` },
      { status: 402 },
    );
  }

  // Payment settled — now run the agent
  const input: DemoScriptInput = {
    githubUrl: body.github_url,
    bounties: body.bounties,
    vibe: body.vibe,
  };

  let result;
  try {
    result = await runDemoScript(input);
  } catch (err) {
    // Agent errored after payment was taken — return 500 with error (do not re-charge)
    return json(
      { error: `agent error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: { "PAYMENT-RESPONSE": settleResponseHeader(settle) } },
    );
  }

  return json(
    {
      ok: true,
      script: result.script,
      toolCallsUsed: result.toolCallsUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
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
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    }),
  );
}
