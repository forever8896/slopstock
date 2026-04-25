/**
 * Mock data. Shaped to match the eventual @stratum/indexer API surface so we
 * can swap in real data with no caller changes.
 *
 * Anywhere this file is imported, we display a `[mock]` indicator in the UI so
 * judges and reviewers can see what's real vs. simulated.
 */

import { HERO_AGENT } from "@stratum/shared";

export interface MockAgent {
  tokenId: bigint;
  ticker: string;
  ens: string;
  name: string;
  description: string;
  modelBase: string;
  pricing: { perCallUsdc: bigint; perCallHuman: string };
  ipo: {
    pricePerShareUsdc: bigint;
    sold: bigint;
    allocation: bigint;
    totalSupply: bigint;
  };
  revenue: {
    last7dUsdc: bigint;
    cumulativeUsdc: bigint;
    callsToday: number;
  };
  contracts: {
    iNFT: `0x${string}`;
    shareToken: `0x${string}`;
    vault: `0x${string}`;
  };
  expectedTeeMeasurement: `0x${string}`;
}

export interface MockHolder {
  address: `0x${string}`;
  shares: bigint;
}

export interface MockSnapshot {
  id: number;
  timestampSec: number;
  totalDistributedUsdc: bigint;
}

export interface MockInferenceLog {
  callId: string;
  inputHash: `0x${string}`;
  subscriber: `0x${string}`;
  ts: number;
  verified: boolean;
}

const auditor: MockAgent = {
  tokenId: 42n,
  ticker: HERO_AGENT.ticker,
  ens: HERO_AGENT.ens,
  name: "auditor",
  description: "Sealed Solidity audit agent. Pay 1 USDC, get a structured audit with TEE-attested provenance.",
  modelBase: "qwen2.5-coder-32b + audit-lora-v1 (sealed)",
  pricing: { perCallUsdc: 1_000_000n, perCallHuman: "$1.00" },
  ipo: {
    pricePerShareUsdc: 1_000_000n, // $1
    sold: 300_000n * 10n ** 18n,
    allocation: 300_000n * 10n ** 18n,
    totalSupply: 1_000_000n * 10n ** 18n,
  },
  revenue: {
    last7dUsdc: 12_500_000n, // $12.50
    cumulativeUsdc: 87_500_000n, // $87.50
    callsToday: 3,
  },
  contracts: {
    iNFT: "0xA6e7000000000000000000000000000000000042",
    shareToken: "0x5Ae71000000000000000000000000000000000aD",
    vault: "0xBaA1100000000000000000000000000000000060",
  },
  expectedTeeMeasurement: "0x9a3f0000000000000000000000000000000000000000000000000000000000ff",
};

export const mockAgents: MockAgent[] = [auditor];

export function findMockAgent(ticker: string): MockAgent | undefined {
  return mockAgents.find((a) => a.ticker === ticker);
}

export const mockHolders: Record<string, MockHolder[]> = {
  AUDIT: [
    { address: "0x0FF1CE0000000000000000000000000000000001", shares: 700_000n * 10n ** 18n },
    { address: "0xa11Ce00000000000000000000000000000000020", shares: 200_000n * 10n ** 18n },
    { address: "0xb0b0000000000000000000000000000000000010", shares: 100_000n * 10n ** 18n },
  ],
};

export const mockSnapshots: Record<string, MockSnapshot[]> = {
  AUDIT: [
    { id: 4, timestampSec: nowMinusDays(0.5), totalDistributedUsdc: 5_000_000n },
    { id: 3, timestampSec: nowMinusDays(7.5), totalDistributedUsdc: 4_200_000n },
    { id: 2, timestampSec: nowMinusDays(14.5), totalDistributedUsdc: 3_800_000n },
    { id: 1, timestampSec: nowMinusDays(21.5), totalDistributedUsdc: 2_500_000n },
  ],
};

export const mockInferences: Record<string, MockInferenceLog[]> = {
  AUDIT: [
    {
      callId: "99bc6227-1200-4e98-9094-dd1d354211f3",
      inputHash: "0x4d6d3142c99cf71d03dea14fbe49d24cfa4ae0999bd899733154f180e9cb1275",
      subscriber: "0x1111111111111111111111111111111111111111",
      ts: nowMinusMinutes(2),
      verified: true,
    },
    {
      callId: "b3a7e1d4-9c12-4f3e-a01b-c8d2f9e547aa",
      inputHash: "0x8ab1f29c4d31e7b85f6cd0413a7e8b2c5f0d1e6a9b3c4d5e6f70819a2b3c4d5e",
      subscriber: "0x2222222222222222222222222222222222222222",
      ts: nowMinusMinutes(8),
      verified: true,
    },
    {
      callId: "c5f9d8e2-7b34-4a98-b0c1-3e8f6d4a9b21",
      inputHash: "0x1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f7081",
      subscriber: "0x3333333333333333333333333333333333333333",
      ts: nowMinusMinutes(14),
      verified: true,
    },
  ],
};

function nowMinusDays(d: number): number {
  return Math.floor(Date.now() / 1000 - d * 86_400);
}
function nowMinusMinutes(m: number): number {
  return Math.floor(Date.now() / 1000 - m * 60);
}
