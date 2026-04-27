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

  const body = (await res.json()) as { callId: string; output: string; receipt: InferenceReceipt };
  return { ok: true, ...body };
}

