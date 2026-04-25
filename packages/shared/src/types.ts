/**
 * Canonical schemas — see docs/01-architecture.md §6.
 *
 * Bumping any schemaVersion is a breaking change. Coordinate across all
 * workspaces before merging.
 */

export interface AgentMetadata {
  schemaVersion: "stratum/agent/v1";
  name: string;                  // ENS, e.g. "auditor.stratum.eth"
  ticker: string;                // e.g. "AUDIT"
  description: string;
  modelBase: string;             // e.g. "qwen2.5-coder-32b"
  loraURI?: string;              // 0g://... (encrypted)
  systemPromptURI: string;
  ragCorpusURI?: string;
  executor: {
    kind: "0g-compute-sealed";
    minTeeAttestation: "TDX" | "SEV-SNP" | "H100" | "H200";
    endpointHint: string;
  };
  pricing: {
    perCall: string;             // smallest unit (e.g. "1000000" for 1 USDC)
    asset: string;               // ERC-20 address (USDC.base for v1)
    currency: string;            // human-readable label
  };
  vault: string;                 // RevenueVault address (Base)
  shareToken: string;            // ShareToken address (0G)
  ens: string;                   // mirrors `name`
  createdAt: number;             // unix seconds
  version: number;               // bumps on any field change
}

export interface InferenceReceipt {
  schemaVersion: "stratum/receipt/v1";
  tokenId: number;
  subscriber: string;            // 0x…
  callId: string;                // uuidv4
  input: string;                 // sha256 hex of input
  outputHash: string;            // sha256 hex of output
  model: string;                 // e.g. "qwen2.5-coder-32b@stratum-audit-lora-v1"
  teeAttestation: {
    vendor: "intel-tdx" | "amd-sev-snp" | "nvidia-h100" | "nvidia-h200";
    quote: string;               // base64
    measurement: string;         // 0x… (32 bytes)
  };
  paymentProof: string;          // x402 receipt id
  ts: number;                    // unix seconds
  signature: string;             // 0x… signed by TEE pubkey
}

export interface RevenueSnapshot {
  snapshotId: number;
  blockNumber: number;
  totalShares: string;
  balance: string;               // smallest unit of payment asset
  holders: Array<{ addr: string; shares: string }>;
}
