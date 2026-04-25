/**
 * HTTP gateway built on Bun.serve.
 *
 * Two routes:
 *
 *   POST /x402/infer
 *     - No X-PAYMENT-V1-RESPONSE header → return 402 with payment instructions
 *     - With a valid receipt → grant authorizeUsage onchain (TODO) and run inference
 *
 *   GET /healthz
 *     - Liveness for AXL bridge / load balancers.
 *
 * Production runs this behind AXL's localhost forwarder so the wire is e2e
 * encrypted; in dev you can curl localhost:8402 directly.
 */

import type { Clients } from "../chain/clients.ts";
import type { ComputeClient } from "../compute/client.ts";
import type { ReceiptSigner } from "../compute/receipt.ts";
import type { OperatorConfig } from "../config.ts";
import { recordReceipt } from "../store/receipts.ts";
import { build402Response, parsePaymentHeader, type PaymentChallenge, validateReceipt } from "./x402.ts";

export interface HttpDeps {
  config: OperatorConfig;
  clients: Clients;
  compute: ComputeClient;
  receiptSigner: ReceiptSigner;
  vaultAddress: `0x${string}`;
}

export function startHttpServer(deps: HttpDeps) {
  return Bun.serve({
    port: deps.config.HTTP_PORT,
    async fetch(req: Request) {
      const url = new URL(req.url);

      if (url.pathname === "/healthz") {
        return new Response(JSON.stringify({ ok: true, demoMode: deps.config.DEMO_MODE }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.pathname === "/x402/infer" && req.method === "POST") {
        return handleInfer(req, deps);
      }

      return new Response("not found", { status: 404 });
    },
  });
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

  const validation = await validateReceipt(receipt, challenge, deps.config);
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

  const compute = await deps.compute.runInference({
    tokenId,
    subscriber: body.subscriber,
    input: body.input,
    paymentReceiptId: validation.receiptId,
  });

  const inferenceReceipt = await deps.receiptSigner.build(
    compute,
    { tokenId, subscriber: body.subscriber, paymentReceiptId: validation.receiptId },
    callId,
  );
  recordReceipt(inferenceReceipt);

  return new Response(
    JSON.stringify({ callId, output: compute.output, receipt: inferenceReceipt }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
}
