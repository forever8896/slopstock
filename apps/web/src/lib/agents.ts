/**
 * Server-side data loaders. Compose on-chain reads (via viem) with the
 * off-chain metadata from agent-metadata.ts to produce the typed shapes the
 * UI components consume.
 *
 * One loader per primitive — caller picks what it needs.
 */

import { ZG_GALILEO, BASE_SEPOLIA_AGENTS, getAgent, type Hex } from "@stratum/shared";
import {
  agentRegistryAbi,
  ipoSaleAbi,
  revenueVaultAbi,
  shareTokenAbi,
  marketplaceAbi,
} from "@stratum/contracts-types";
import { zgPublicClient, basePublicClient } from "./chain";
import { AGENT_METADATA, type AgentOffchainMeta } from "./agent-metadata";

export interface AgentSummary {
  ticker: string;
  ens: string;
  tokenId: bigint;
  perCallUsdc: bigint;
  perCallHuman: string;
  pricePerShareUsdc: bigint;
  cumulativeRevenueUsdc: bigint;
  callsToday: number;
  runtime: "hermes" | "openai-compat";
}

export interface AgentDetail extends AgentSummary {
  name: string;
  description: string;
  modelBase: string;
  expectedTeeMeasurement: Hex;
  ipo: {
    pricePerShareUsdc: bigint;
    sold: bigint;
    allocation: bigint;
    totalSupply: bigint;
    startsAt: number;
    endsAt: number;
    isOpen: boolean;
  };
  contracts: {
    iNFT: Hex;
    shareToken: Hex;
    vault: Hex;
    ipoSale: Hex;
    marketplace: Hex;
    agentRegistry: Hex;
  };
  bestBid: { bidder: Hex; price: bigint; expiresAt: number } | null;
}

export interface Holder {
  address: Hex;
  shares: bigint;
}

export interface Snapshot {
  id: number;
  timestampSec: number;
  totalDistributedUsdc: bigint;
}

export interface InferenceLog {
  callId: string;
  inputHash: Hex;
  subscriber: Hex;
  ts: number;
  verified: boolean;
}

const SECONDS_PER_DAY = 86_400;

export async function listAgents(): Promise<AgentSummary[]> {
  return Promise.all(Object.keys(BASE_SEPOLIA_AGENTS).map(loadAgentSummary));
}

export async function loadAgentSummary(ticker: string): Promise<AgentSummary> {
  const agent = getAgent(ticker);
  const meta = mustMeta(ticker);

  const [pricePerShareUsdc, snapshots] = await Promise.all([
    basePublicClient.readContract({
      address: agent.ipoSale,
      abi: ipoSaleAbi,
      functionName: "pricePerShare",
    }),
    loadSnapshots(ticker),
  ]);

  const cumulativeRevenueUsdc = snapshots.reduce(
    (acc, s) => acc + s.totalDistributedUsdc,
    0n,
  );
  const callsToday = await callsInLastNSeconds(ticker, SECONDS_PER_DAY);

  return {
    ticker: ticker.toUpperCase(),
    ens: agent.ensName,
    tokenId: agent.tokenId,
    perCallUsdc: meta.perCallUsdc,
    perCallHuman: meta.perCallHuman,
    pricePerShareUsdc,
    cumulativeRevenueUsdc,
    callsToday,
    runtime: agent.runtime,
  };
}

export async function loadAgentDetail(ticker: string): Promise<AgentDetail | null> {
  const agent = BASE_SEPOLIA_AGENTS[ticker.toUpperCase()];
  if (!agent) return null;
  const meta = mustMeta(ticker);

  const [
    pricePerShare,
    sold,
    maxShares,
    startsAt,
    endsAt,
    isOpen,
    totalSupply,
    bestBidRaw,
  ] = await Promise.all([
    basePublicClient.readContract({
      address: agent.ipoSale,
      abi: ipoSaleAbi,
      functionName: "pricePerShare",
    }),
    basePublicClient.readContract({
      address: agent.ipoSale,
      abi: ipoSaleAbi,
      functionName: "sold",
    }),
    basePublicClient.readContract({
      address: agent.ipoSale,
      abi: ipoSaleAbi,
      functionName: "maxShares",
    }),
    basePublicClient.readContract({
      address: agent.ipoSale,
      abi: ipoSaleAbi,
      functionName: "startsAt",
    }),
    basePublicClient.readContract({
      address: agent.ipoSale,
      abi: ipoSaleAbi,
      functionName: "endsAt",
    }),
    basePublicClient.readContract({
      address: agent.ipoSale,
      abi: ipoSaleAbi,
      functionName: "isOpen",
    }),
    basePublicClient.readContract({
      address: agent.shareToken,
      abi: shareTokenAbi,
      functionName: "totalSupply",
    }),
    zgPublicClient.readContract({
      address: ZG_GALILEO.marketplace,
      abi: marketplaceAbi,
      functionName: "getBid",
      args: [agent.tokenId],
    }),
  ]);

  const summary = await loadAgentSummary(ticker);

  const zeroBid = bestBidRaw.bidder === "0x0000000000000000000000000000000000000000";
  return {
    ...summary,
    name: meta.name,
    description: meta.description,
    modelBase: meta.modelBase,
    expectedTeeMeasurement: meta.expectedTeeMeasurement,
    ipo: {
      pricePerShareUsdc: pricePerShare,
      sold,
      allocation: maxShares,
      totalSupply,
      startsAt: Number(startsAt),
      endsAt: Number(endsAt),
      isOpen,
    },
    contracts: {
      iNFT: ZG_GALILEO.agentNft,
      shareToken: agent.shareToken,
      vault: agent.revenueVault,
      ipoSale: agent.ipoSale,
      marketplace: ZG_GALILEO.marketplace,
      agentRegistry: ZG_GALILEO.agentRegistry,
    },
    bestBid: zeroBid
      ? null
      : {
          bidder: bestBidRaw.bidder,
          price: bestBidRaw.price,
          expiresAt: Number(bestBidRaw.expiresAt),
        },
  };
}

/**
 * Walks Transfer events on the ShareToken to derive current holder balances.
 * Public RPCs cap getLogs at ~50k blocks per call, so we paginate from the
 * agent's deploy block to head. Once @stratum/indexer ships, replace with a
 * single REST call.
 */
export async function loadHolders(ticker: string): Promise<Holder[]> {
  const agent = getAgent(ticker);
  const transferEvent = shareTokenAbi.find(
    (e) => e.type === "event" && e.name === "Transfer",
  ) as never;

  const balances = new Map<Hex, bigint>();
  const head = await basePublicClient.getBlockNumber();
  const STEP = 45_000n; // safely under the 50k publicnode cap

  for (let from = agent.baseDeployBlock; from <= head; from += STEP + 1n) {
    const to = from + STEP > head ? head : from + STEP;
    const logs = await basePublicClient.getLogs({
      address: agent.shareToken,
      event: transferEvent,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const args = (log as unknown as { args: { from: Hex; to: Hex; value: bigint } }).args;
      if (!args) continue;
      if (args.from !== "0x0000000000000000000000000000000000000000") {
        balances.set(args.from, (balances.get(args.from) ?? 0n) - args.value);
      }
      if (args.to !== "0x0000000000000000000000000000000000000000") {
        balances.set(args.to, (balances.get(args.to) ?? 0n) + args.value);
      }
    }
  }

  return [...balances.entries()]
    .filter(([, shares]) => shares > 0n)
    .map(([address, shares]) => ({ address, shares }))
    .sort((a, b) => (b.shares > a.shares ? 1 : b.shares < a.shares ? -1 : 0));
}

export async function loadSnapshots(ticker: string): Promise<Snapshot[]> {
  const agent = getAgent(ticker);

  const count = await basePublicClient.readContract({
    address: agent.revenueVault,
    abi: revenueVaultAbi,
    functionName: "snapshotCount",
  });

  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const rows = await Promise.all(
    ids.map((id) =>
      basePublicClient.readContract({
        address: agent.revenueVault,
        abi: revenueVaultAbi,
        functionName: "snapshotAt",
        args: [id],
      }),
    ),
  );

  return rows
    .map(([, balanceAtSnapshot, ts], i) => ({
      id: i,
      timestampSec: Number(ts),
      totalDistributedUsdc: balanceAtSnapshot,
    }))
    .sort((a, b) => b.timestampSec - a.timestampSec);
}

export async function loadInferences(ticker: string): Promise<InferenceLog[]> {
  const operatorUrl = process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";
  const agent = getAgent(ticker);

  try {
    const res = await fetch(`${operatorUrl}/receipts?tokenId=${agent.tokenId}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      receipts: Array<{
        callId: string;
        subscriber: Hex;
        input: Hex; // input hash (keccak of bytes)
        outputHash: Hex;
        ts: number;
        signature: Hex;
      }>;
    };
    return body.receipts.map((r) => ({
      callId: r.callId,
      inputHash: r.input,
      subscriber: r.subscriber,
      ts: r.ts,
      verified: typeof r.signature === "string" && r.signature.length > 2,
    }));
  } catch {
    return [];
  }
}

async function callsInLastNSeconds(ticker: string, seconds: number): Promise<number> {
  const inferences = await loadInferences(ticker);
  const cutoff = Math.floor(Date.now() / 1000) - seconds;
  return inferences.filter((i) => i.ts >= cutoff).length;
}

function mustMeta(ticker: string): AgentOffchainMeta {
  const meta = AGENT_METADATA[ticker.toUpperCase()];
  if (!meta) throw new Error(`no off-chain metadata for ticker ${ticker}`);
  return meta;
}
