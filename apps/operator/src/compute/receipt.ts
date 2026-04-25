/**
 * Build + sign InferenceReceipt objects (the canonical schema lives in
 * @stratum/shared). The operator's signing key here is intentionally separate
 * from any chain-writing key: receipt provenance is an off-chain trust signal
 * and the keys can rotate independently.
 */

import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { InferenceReceipt } from "@stratum/shared";
import type { OperatorConfig } from "../config.ts";
import type { InferenceResponse } from "./types.ts";

export interface ReceiptSigner {
  build(
    response: InferenceResponse,
    request: { tokenId: bigint; subscriber: `0x${string}`; paymentReceiptId: string },
    callId: string,
  ): Promise<InferenceReceipt>;
}

export function buildReceiptSigner(config: OperatorConfig): ReceiptSigner {
  return new EcdsaReceiptSigner(config);
}

class EcdsaReceiptSigner implements ReceiptSigner {
  private readonly account: ReturnType<typeof privateKeyToAccount> | undefined;

  constructor(config: OperatorConfig) {
    if (config.OPERATOR_PRIVATE_KEY) {
      this.account = privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as `0x${string}`);
    }
  }

  async build(
    response: InferenceResponse,
    request: { tokenId: bigint; subscriber: `0x${string}`; paymentReceiptId: string },
    callId: string,
  ): Promise<InferenceReceipt> {
    // Receipts are bound to the operator's signing key. In production we
    // additionally bind to the TEE attestation public key (verified separately
    // by the subscriber); for now the operator signature is enough to prove
    // origin, and the TEE quote in the receipt proves the model identity.
    const digest = keccak256(
      toHex(
        new TextEncoder().encode(
          [callId, request.tokenId.toString(), request.subscriber, response.outputHash, response.ts.toString()].join(
            "|",
          ),
        ),
      ),
    );

    const signature = this.account ? await this.account.signMessage({ message: { raw: digest } }) : ("0x" as const);

    return {
      schemaVersion: "stratum/receipt/v1",
      tokenId: Number(request.tokenId),
      subscriber: request.subscriber,
      callId,
      input: response.inputHash,
      outputHash: response.outputHash,
      model: response.model,
      teeAttestation: {
        vendor: response.teeVendor,
        quote: response.teeQuote,
        measurement: response.measurement,
      },
      paymentProof: request.paymentReceiptId,
      ts: response.ts,
      signature,
    };
  }
}
