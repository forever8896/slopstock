/**
 * Internal shape of a 0G Compute Sealed Executor inference call.
 *
 * Wraps the OpenAI-compatible request the proxy expects with the metadata we
 * need on top: the agent's tokenId (for measurement lookup), the subscriber
 * (for receipt provenance), and a payment proof from x402.
 */

export interface InferenceRequest {
  tokenId: bigint;
  subscriber: `0x${string}`;
  input: string;
  paymentReceiptId: string;
}

export interface InferenceResponse {
  /// The model's textual output (audit JSON for the hero agent).
  output: string;
  /// Hash of input bytes (for receipt binding).
  inputHash: `0x${string}`;
  /// Hash of output bytes.
  outputHash: `0x${string}`;
  /// Raw TEE attestation quote, base64-encoded.
  teeQuote: string;
  /// On-chain pinned measurement that the quote must match.
  measurement: `0x${string}`;
  /// Vendor of the TEE (informational).
  teeVendor: "intel-tdx" | "amd-sev-snp" | "nvidia-h100" | "nvidia-h200";
  /// Model identifier that ran (e.g. "qwen2.5-coder-32b@stratum-audit-lora-v1").
  model: string;
  /// Operator-side wall-clock timestamp.
  ts: number;
}
