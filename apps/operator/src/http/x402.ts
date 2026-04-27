/**
 * x402 payment helpers.
 *
 * The operator self-validates payment receipts by reading the txHash on
 * Base Sepolia and decoding USDC Transfer logs. No facilitator dependency —
 * the chain itself is the facilitator. This is more conservative than a
 * facilitator round-trip (we observe what's actually on chain) and works for
 * any wallet that emits a vanilla USDC ERC-20 transfer to the vault.
 */

import { decodeEventLog } from "viem";
import { erc20Abi } from "../chain/abis.ts";
import type { Clients } from "../chain/clients.ts";
import type { OperatorConfig } from "../config.ts";

export interface PaymentChallenge {
  network: "base";
  asset: "USDC";
  amount: string; // smallest unit
  recipient: `0x${string}`;
}

export interface PaymentReceipt {
  txHash: `0x${string}`;
  facilitator: string;
  receiptId: string;
}

export function build402Response(challenge: PaymentChallenge): Response {
  return new Response("Payment Required", {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT-V1": JSON.stringify(challenge),
    },
  });
}

/**
 * Verify the txHash transferred ≥ `expected.amount` of USDC to
 * `expected.recipient` on Base Sepolia.
 */
export async function validateReceipt(
  receipt: PaymentReceipt | null,
  expected: PaymentChallenge,
  config: OperatorConfig,
  clients: Clients,
): Promise<{ ok: true; receiptId: string } | { ok: false; reason: string }> {
  if (!receipt) return { ok: false, reason: "missing payment receipt" };
  if (!receipt.receiptId) return { ok: false, reason: "empty receiptId" };
  if (!receipt.txHash || !receipt.txHash.startsWith("0x")) {
    return { ok: false, reason: "invalid txHash" };
  }

  let txReceipt;
  try {
    txReceipt = await clients.basePublic.getTransactionReceipt({ hash: receipt.txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(msg) || /could not be found/i.test(msg)) {
      return { ok: false, reason: "tx not found on Base Sepolia" };
    }
    return { ok: false, reason: `chain read failed: ${msg.slice(0, 200)}` };
  }

  if (txReceipt.status !== "success") {
    return { ok: false, reason: "tx reverted" };
  }

  if (config.X402_MIN_CONFIRMATIONS > 0) {
    const head = await clients.basePublic.getBlockNumber();
    const confirmations = head - txReceipt.blockNumber + 1n;
    if (confirmations < BigInt(config.X402_MIN_CONFIRMATIONS)) {
      return { ok: false, reason: `insufficient confirmations (${confirmations}/${config.X402_MIN_CONFIRMATIONS})` };
    }
  }

  const expectedAmount = BigInt(expected.amount);
  const expectedRecipient = expected.recipient.toLowerCase();
  const expectedAsset = config.X402_USDC_ADDRESS.toLowerCase();

  // Walk the receipt's logs, find any Transfer from the USDC contract
  // whose recipient matches and value covers the challenge amount.
  for (const log of txReceipt.logs) {
    if (log.address.toLowerCase() !== expectedAsset) continue;
    let decoded: { eventName: string; args: { from: `0x${string}`; to: `0x${string}`; value: bigint } };
    try {
      decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
      }) as typeof decoded;
    } catch {
      continue;
    }
    if (decoded.eventName !== "Transfer") continue;
    if (decoded.args.to.toLowerCase() !== expectedRecipient) continue;
    if (decoded.args.value < expectedAmount) continue;
    return { ok: true, receiptId: receipt.receiptId };
  }

  return {
    ok: false,
    reason: `no USDC transfer >= ${expectedAmount} to ${expectedRecipient} in tx ${receipt.txHash}`,
  };
}

export function parsePaymentHeader(headerValue: string | null): PaymentReceipt | null {
  if (!headerValue) return null;
  try {
    const parsed = JSON.parse(headerValue) as PaymentReceipt;
    if (!parsed.txHash || !parsed.receiptId) return null;
    return parsed;
  } catch {
    return null;
  }
}
