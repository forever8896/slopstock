/**
 * HTTP gateway built on Bun.serve.
 *
 * Routes:
 *
 *   POST /x402/infer
 *     - No X-PAYMENT-V1-RESPONSE header → return 402 with payment instructions
 *     - With a valid receipt → run inference, persist receipt, return JSON
 *
 *   GET /healthz
 *     - Liveness for AXL bridge / load balancers.
 *
 *   GET /profile/:tokenId
 *     - Chain-driven agent profile (AgentRegistry + iNFT).
 *
 *   GET /receipts?tokenId=N&subscriber=0x…
 *     - Recent inference receipts. Used by the web app's loadInferences loader.
 *
 * CORS is permissive so the dev frontend can hit this directly.
 */

import type { Clients } from "../chain/clients.ts";
import type { ComputeClient } from "../compute/client.ts";
import { ComputeError } from "../compute/client.ts";
import type { ReceiptSigner } from "../compute/receipt.ts";
import type { OperatorConfig } from "../config.ts";
import { handleProfile } from "../mcp/tools.ts";
import { listReceipts, recordReceipt } from "../store/receipts.ts";
import { build402Response, parsePaymentHeader, type PaymentChallenge, validateReceipt } from "./x402.ts";

export interface HttpDeps {
  config: OperatorConfig;
  clients: Clients;
  compute: ComputeClient;
  receiptSigner: ReceiptSigner;
  vaultAddress: `0x${string}`;
  agentNftAddress: `0x${string}`;
  agentRegistryAddress: `0x${string}`;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT-V1-RESPONSE",
  "Access-Control-Expose-Headers": "X-PAYMENT-V1",
};

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, bigintReplacer, 2), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

export function startHttpServer(deps: HttpDeps) {
  return Bun.serve({
    port: deps.config.HTTP_PORT,
    async fetch(req: Request) {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(req.url);

      if (url.pathname === "/healthz") {
        return withCors(json({ ok: true, operator: deps.clients.account.address }));
      }

      const profileMatch = url.pathname.match(/^\/profile\/(\d+)$/);
      if (profileMatch && req.method === "GET") {
        return withCors(await handleProfileRoute(profileMatch[1]!, deps));
      }

      if (url.pathname === "/receipts" && req.method === "GET") {
        return withCors(handleReceiptsRoute(url, deps));
      }

      if (url.pathname === "/x402/infer" && req.method === "POST") {
        return withCors(await handleInfer(req, deps));
      }

      return withCors(new Response("not found", { status: 404 }));
    },
  });
}

async function handleProfileRoute(tokenIdStr: string, deps: HttpDeps): Promise<Response> {
  try {
    const profile = await handleProfile(
      { tokenId: tokenIdStr },
      {
        config: deps.config,
        clients: deps.clients,
        compute: deps.compute,
        receiptSigner: deps.receiptSigner,
        agentNftAddress: deps.agentNftAddress,
        agentRegistryAddress: deps.agentRegistryAddress,
      },
    );
    return json(profile);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}

function handleReceiptsRoute(url: URL, _deps: HttpDeps): Response {
  const tokenIdRaw = url.searchParams.get("tokenId");
  const subscriber = url.searchParams.get("subscriber") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const tokenId = tokenIdRaw ? BigInt(tokenIdRaw) : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const receipts = listReceipts({ tokenId, subscriber, limit });
  return json({ receipts });
}

async function handleInfer(req: Request, deps: HttpDeps): Promise<Response> {
  const challenge: PaymentChallenge = {
    network: "base",
    asset: "USDC",
    amount: "1000000",
    recipient: deps.vaultAddress,
  };

  const receipt = parsePaymentHeader(req.headers.get("X-PAYMENT-V1-RESPONSE"));
  if (!receipt) return build402Response(challenge);

  const validation = await validateReceipt(receipt, challenge, deps.config, deps.clients);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.reason }), {
      status: 402,
      headers: { "Content-Type": "application/json", "X-PAYMENT-V1": JSON.stringify(challenge) },
    });
  }

  let body: { tokenId: string | number; input: string; subscriber: `0x${string}` };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
  }

  const tokenId = typeof body.tokenId === "string" ? BigInt(body.tokenId) : BigInt(body.tokenId);
  const callId = crypto.randomUUID();

  let compute;
  try {
    compute = await deps.compute.runInference({
      tokenId,
      subscriber: body.subscriber,
      input: body.input,
      paymentReceiptId: validation.receiptId,
    });
  } catch (err) {
    if (err instanceof ComputeError) {
      return new Response(
        JSON.stringify({ error: `compute backend unavailable: ${err.message}` }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    throw err;
  }

  const inferenceReceipt = await deps.receiptSigner.build(
    compute,
    { tokenId, subscriber: body.subscriber, paymentReceiptId: validation.receiptId },
    callId,
  );
  recordReceipt(inferenceReceipt);

  return json({ callId, output: compute.output, receipt: inferenceReceipt });
}
