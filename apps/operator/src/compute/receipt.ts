/**
 * Build + sign InferenceReceipt objects (canonical schema in @stratum/shared).
 *
 * Updated for v2 receipts: takes a full AgentTaskOutput so the receipt carries
 * the agent's transcript, bundle delta, and skills used.
 *
 * Operator signing key is separate from any chain-writing key. Receipt
 * provenance is an off-chain trust signal; the chain-pinned `measurement`
 * inside `teeAttestation` is what subscribers verify against on-chain.
 */

import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentRuntimeKind, ComputeBackendKind, InferenceReceipt } from "@stratum/shared";
import type { OperatorConfig } from "../config.ts";
import type { AgentTaskOutput } from "../runtime/types.ts";

export interface ReceiptSigner {
  build(
    runtime: AgentRuntimeKind,
    response: AgentTaskOutput,
    request: { tokenId: bigint; subscriber: `0x${string}`; paymentReceiptId: string },
    callId: string,
  ): Promise<InferenceReceipt>;
}

function computeBackendOf(att: AgentTaskOutput["backendAttestation"]): ComputeBackendKind {
  return att.kind === "0g-tee" ? "0g-compute" : "openai-compat";
}

export function buildReceiptSigner(config: OperatorConfig): ReceiptSigner {
  return new EcdsaReceiptSigner(config);
}

class EcdsaReceiptSigner implements ReceiptSigner {
  private readonly account: ReturnType<typeof privateKeyToAccount>;

  constructor(config: OperatorConfig) {
    this.account = privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as `0x${string}`);
  }

  async build(
    runtime: AgentRuntimeKind,
    response: AgentTaskOutput,
    request: { tokenId: bigint; subscriber: `0x${string}`; paymentReceiptId: string },
    callId: string,
  ): Promise<InferenceReceipt> {
    // The digest commits to the agent's state delta as well as the I/O — so
    // a verifier can reject any receipt where the on-chain bundle hash
    // doesn't match what the receipt claims the agent moved through.
    const digest = keccak256(
      toHex(
        new TextEncoder().encode(
          [
            callId,
            request.tokenId.toString(),
            request.subscriber,
            response.outputHash,
            response.stateDeltaHash,
            response.ts.toString(),
          ].join("|"),
        ),
      ),
    );

    const signature = await this.account.signMessage({ message: { raw: digest } });

    return {
      schemaVersion: "stratum/receipt/v2",
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
      agentRuntime: runtime,
      computeBackend: computeBackendOf(response.backendAttestation),
      bundleHashBefore: response.bundleHashBefore,
      bundleHashAfter: response.bundleHashAfter,
      stateDeltaHash: response.stateDeltaHash,
      skillsLoaded: response.skillsLoaded,
      skillsCreated: response.skillsCreated,
      transcript: response.transcript,
      ts: response.ts,
      signature,
    };
  }
}
