/**
 * Typed client for the operator's HTTP gateway.
 *
 * Mirrors apps/operator/src/http/server.ts. The browser hits the operator
 * directly (CORS permits it). In production the operator sits behind AXL's
 * localhost forwarder; the API surface is identical.
 */

import type { InferenceReceipt } from "@stratum/shared";

const OPERATOR_URL = process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";

export interface PaymentChallenge {
  network: "base";
  asset: "USDC";
  amount: string;
  recipient: `0x${string}`;
}

export interface PaymentReceipt {
  txHash: `0x${string}`;
  facilitator: string;
  receiptId: string;
}

export interface InferRequest {
  tokenId: number | string;
  input: string;
  subscriber: `0x${string}`;
  /** If absent, the operator returns 402 with the challenge to satisfy. */
  paymentReceipt?: PaymentReceipt;
}

export interface InferSuccess {
  ok: true;
  callId: string;
  output: string;
  receipt: InferenceReceipt;
}

export interface InferPaymentRequired {
  ok: false;
  kind: "payment-required";
  challenge: PaymentChallenge;
}

export interface InferError {
  ok: false;
  kind: "error";
  status: number;
  message: string;
}

export type InferResult = InferSuccess | InferPaymentRequired | InferError;

/**
 * Poll /x402/calls/:callId until the operator's background inference
 * settles. Lets us survive the Railway proxy's 60s edge timeout for slow
 * paths (mainnet TEE + cross-agent x402 + Hermes can run 30-90s).
 */
async function pollInferResult(callId: string): Promise<InferResult> {
  const POLL_INTERVAL_MS = 2000;
  const MAX_WAIT_MS = 180_000;
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let res: Response;
    try {
      res = await fetch(`${OPERATOR_URL}/x402/calls/${callId}`, { cache: "no-store" });
    } catch {
      // Transient network error mid-poll — try again next tick.
      continue;
    }
    if (res.status === 404) {
      return { ok: false, kind: "error", status: 404, message: "call not found (operator restarted?)" };
    }
    let body: { status?: string; callId?: string; output?: string; receipt?: InferenceReceipt; message?: string };
    try {
      body = await res.json();
    } catch {
      continue;
    }
    if (body.status === "running") continue;
    if (body.status === "complete" && body.callId && body.output && body.receipt) {
      return { ok: true, callId: body.callId, output: body.output, receipt: body.receipt };
    }
    if (body.status === "error") {
      return { ok: false, kind: "error", status: 500, message: body.message ?? "operator error" };
    }
  }
  return { ok: false, kind: "error", status: 0, message: "polling timed out (>3min)" };
}

export async function infer(req: InferRequest): Promise<InferResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req.paymentReceipt) {
    headers["X-PAYMENT-V1-RESPONSE"] = JSON.stringify(req.paymentReceipt);
  }

  let res: Response;
  try {
    res = await fetch(`${OPERATOR_URL}/x402/infer`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tokenId: req.tokenId, input: req.input, subscriber: req.subscriber }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "error", status: 0, message: `network error: ${message}` };
  }

  if (res.status === 402) {
    const raw = res.headers.get("X-PAYMENT-V1");
    if (raw) {
      try {
        const challenge = JSON.parse(raw) as PaymentChallenge;
        return { ok: false, kind: "payment-required", challenge };
      } catch {
        return { ok: false, kind: "error", status: 402, message: "malformed payment challenge" };
      }
    }
    return { ok: false, kind: "error", status: 402, message: "402 without challenge header" };
  }

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, kind: "error", status: res.status, message: text || res.statusText };
  }

  const body = (await res.json()) as
    | { callId: string; output: string; receipt: InferenceReceipt }
    | { ok: true; status: "running"; callId: string };

  // Async path: operator returned a callId, kicked off in background. Poll.
  if ("status" in body && body.status === "running") {
    return await pollInferResult(body.callId);
  }
  // Backward-compat sync path (e.g. older operators or future fast paths).
  if ("output" in body && "receipt" in body && body.callId) {
    return { ok: true, callId: body.callId, output: body.output, receipt: body.receipt };
  }
  return { ok: false, kind: "error", status: 500, message: "operator response in unknown shape" };
}

