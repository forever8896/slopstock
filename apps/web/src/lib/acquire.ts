/**
 * Acquisition flow — types + helpers.
 *
 * The flow is shaped against `contracts/src/market/Marketplace.sol` and
 * `contracts/src/interfaces/IAgentNFT.sol`. Today the page simulates the
 * sequence end-to-end (no live RPC); swap to wagmi `useWriteContract` once
 * Marketplace + StratumAgentNFT are deployed.
 */

import { keccak256, toHex, type Hex } from "viem";

export interface BidState {
  bidder: `0x${string}`;
  price: bigint; // smallest unit of USDC (6 decimals)
  pubkey: Hex;
  expiresAt: number; // unix seconds
}

export type EventKind =
  | "post"
  | "tee"
  | "transfer"
  | "revoke"
  | "ens"
  | "result"
  | "info";

export interface EventLogEntry {
  ts: number; // ms since epoch
  kind: EventKind;
  title: string;
  lines: string[];
}

/**
 * Produce a deterministic-ish 32-byte hash for demo events. Driven by entropy
 * from crypto.getRandomValues so each demo run looks fresh.
 */
export function fakeHash32(seed?: string): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  if (seed) {
    const s = new TextEncoder().encode(seed);
    for (let i = 0; i < s.length; i++) {
      // s[i] is non-undefined under the standard ArrayBuffer typing,
      // but TypeScript widens via the encoder; index access is asserted.
      const b = s[i] as number;
      const j = bytes[i % 32] as number;
      bytes[i % 32] = (b ^ j) & 0xff;
    }
  }
  return keccak256(toHex(bytes));
}

/**
 * Default demo bid — pre-fills the bidder side so a judge can "act as
 * operator" without first acting as bidder. The bid amount is large enough
 * to feel real (the agent's market cap at $1/share is $1M).
 */
export function defaultDemoBid(): BidState {
  return {
    bidder: "0xACC0017E000000000000000000000000ACC01242",
    price: 50_000n * 1_000_000n, // 50,000 USDC
    pubkey: "0x04abcd0123456789defabcdef1234567890abcdef1234567890abcdef12345678",
    expiresAt: Math.floor(Date.now() / 1000) + 48 * 3_600,
  };
}

/**
 * Generate the full simulated event sequence for an acceptance, with realistic
 * sub-second offsets between blockchain events. Returns an array; the page
 * appends them to the log on a timer for the cinematic effect.
 */
export function buildAcceptSequence(opts: {
  bid: BidState;
  seller: `0x${string}`;
  ensName: string;
  activeSubscribers: number;
}): EventLogEntry[] {
  const t0 = Date.now();
  const teeAttestation = fakeHash32("tee-reencrypt");
  const txTransfer = fakeHash32("itransfer");
  const txEns = fakeHash32("ens-flip");

  return [
    {
      ts: t0,
      kind: "tee",
      title: "TEE re-encryption oracle",
      lines: [
        "generated new content key inside enclave",
        `attestation: ${teeAttestation.slice(0, 18)}…`,
        `sealed under ${opts.bid.bidder.slice(0, 10)}…'s pubkey`,
      ],
    },
    {
      ts: t0 + 320,
      kind: "transfer",
      title: "AgentNFT.iTransfer",
      lines: [
        `from ${opts.seller.slice(0, 10)}… → ${opts.bid.bidder.slice(0, 10)}…`,
        `tx ${txTransfer.slice(0, 18)}…`,
        "TransferValidityProof verified onchain",
      ],
    },
    {
      ts: t0 + 480,
      kind: "revoke",
      title: `UsageRevoked × ${opts.activeSubscribers}`,
      lines: [
        "all active authorizeUsage grants cleared",
        "previous subscribers atomically locked out",
      ],
    },
    {
      ts: t0 + 620,
      kind: "ens",
      title: "ENS resolver updated",
      lines: [
        `${opts.ensName} → ${opts.bid.bidder}`,
        `tx ${txEns.slice(0, 18)}…`,
      ],
    },
    {
      ts: t0 + 760,
      kind: "result",
      title: "Acquired ✓",
      lines: [
        `escrow released: ${(Number(opts.bid.price) / 1e6).toLocaleString()} USDC → seller`,
        "previous owner cryptographically locked out",
      ],
    },
  ];
}
