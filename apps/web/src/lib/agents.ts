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
  /** Real-Agent Launch surface — only populated for permissionless mints. */
  realAgent?: {
    templateId: string;
    runtimeTier: "openai-compat" | "tools-lite" | "hermes";
    backend: "openai-compat" | "0g-compute";
    bundleManifestCid: string;        // 0x-prefixed
    tools: string[];
    patternCount: number;
    skillCount: number;
  };
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

export interface DynamicAgentSummary extends AgentSummary {
  permissionless: true;
}

/**
 * Internal: shape used by every loader so static and dynamic agents share
 * the same code paths.
 */
interface ResolvedAgent {
  ticker: string;
  ens: string;
  tokenId: bigint;
  shareToken: Hex;
  revenueVault: Hex;
  ipoSale: Hex;
  baseDeployBlock: bigint;
  runtime: "hermes" | "openai-compat";
  isDynamic: boolean;
  // Dynamic-only metadata (operator-supplied)
  description?: string;
  modelBase?: string;
  perCallUsdc?: bigint;
  perCallHuman?: string;
  hasFinance: boolean;
  // Real-Agent Launch metadata (only present for manifest-minted dynamic agents)
  realAgent?: AgentDetail["realAgent"];
}

interface DynamicAgentRecord {
  tokenId: string;
  ticker: string;
  description: string;
  systemPrompt: string;
  model: string;
  perCallSmallest: string;
  perCallHuman: string;
  runtime: "hermes" | "openai-compat";
  finance?: { shareToken: string; revenueVault: string; ipoSale: string };
  // Real-Agent Launch fields (optional)
  templateId?: string;
  runtimeTier?: "openai-compat" | "tools-lite" | "hermes";
  backend?: "openai-compat" | "0g-compute";
  bundleManifestCid?: string;
  manifestShadow?: {
    capabilities?: { tools?: string[]; patterns?: unknown[]; skills?: unknown[] };
  };
}

async function fetchDynamicByTicker(ticker: string): Promise<DynamicAgentRecord | null> {
  const operatorUrl = process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";
  try {
    const res = await fetch(`${operatorUrl}/agents`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { agents: DynamicAgentRecord[] };
    return body.agents.find((a) => a.ticker.toUpperCase() === ticker.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

async function resolveAgentForReads(ticker: string): Promise<ResolvedAgent | null> {
  const upper = ticker.toUpperCase();
  const staticAgent = BASE_SEPOLIA_AGENTS[upper];
  if (staticAgent) {
    return {
      ticker: upper,
      ens: staticAgent.ensName,
      tokenId: staticAgent.tokenId,
      shareToken: staticAgent.shareToken,
      revenueVault: staticAgent.revenueVault,
      ipoSale: staticAgent.ipoSale,
      baseDeployBlock: staticAgent.baseDeployBlock,
      runtime: staticAgent.runtime,
      isDynamic: false,
      hasFinance: true,
    };
  }

  const dyn = await fetchDynamicByTicker(upper);
  if (!dyn) return null;
  const realAgent = buildRealAgentMeta(dyn);
  if (dyn.finance) {
    // Walk back ~50k blocks from head — generous window for any agent
    // launched in the last ~28h on Base Sepolia (~2s blocks).
    const head = await basePublicClient.getBlockNumber();
    const baseDeployBlock = head > 50_000n ? head - 50_000n : 0n;
    return {
      ticker: upper,
      ens: `${upper.toLowerCase()}.permissionless`,
      tokenId: BigInt(dyn.tokenId),
      shareToken: dyn.finance.shareToken as Hex,
      revenueVault: dyn.finance.revenueVault as Hex,
      ipoSale: dyn.finance.ipoSale as Hex,
      baseDeployBlock,
      runtime: dyn.runtime,
      isDynamic: true,
      description: dyn.description,
      modelBase: dyn.model,
      perCallUsdc: BigInt(dyn.perCallSmallest),
      perCallHuman: dyn.perCallHuman,
      hasFinance: true,
      ...(realAgent ? { realAgent } : {}),
    };
  }
  // Dynamic agent that hasn't run deploy-finance yet — addresses unknown.
  return {
    ticker: upper,
    ens: `${upper.toLowerCase()}.permissionless`,
    tokenId: BigInt(dyn.tokenId),
    shareToken: "0x0000000000000000000000000000000000000000" as Hex,
    revenueVault: "0x0000000000000000000000000000000000000000" as Hex,
    ipoSale: "0x0000000000000000000000000000000000000000" as Hex,
    baseDeployBlock: 0n,
    runtime: dyn.runtime,
    isDynamic: true,
    description: dyn.description,
    modelBase: dyn.model,
    perCallUsdc: BigInt(dyn.perCallSmallest),
    perCallHuman: dyn.perCallHuman,
    hasFinance: false,
    ...(realAgent ? { realAgent } : {}),
  };
}

function buildRealAgentMeta(dyn: DynamicAgentRecord): AgentDetail["realAgent"] | undefined {
  if (!dyn.bundleManifestCid || !dyn.runtimeTier) return undefined;
  const tools = dyn.manifestShadow?.capabilities?.tools ?? [];
  const patternCount = dyn.manifestShadow?.capabilities?.patterns?.length ?? 0;
  const skillCount = dyn.manifestShadow?.capabilities?.skills?.length ?? 0;
  return {
    templateId: dyn.templateId ?? "(custom)",
    runtimeTier: dyn.runtimeTier,
    backend: dyn.backend ?? "openai-compat",
    bundleManifestCid: dyn.bundleManifestCid.startsWith("0x")
      ? dyn.bundleManifestCid
      : `0x${dyn.bundleManifestCid}`,
    tools,
    patternCount,
    skillCount,
  };
}

export async function listAgents(): Promise<Array<AgentSummary | DynamicAgentSummary>> {
  const [staticAgents, dynamic] = await Promise.all([
    Promise.all(Object.keys(BASE_SEPOLIA_AGENTS).map(loadAgentSummary)),
    listDynamicAgentSummaries(),
  ]);
  return [...staticAgents, ...dynamic];
}

async function listDynamicAgentSummaries(): Promise<DynamicAgentSummary[]> {
  const operatorUrl = process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";
  try {
    const res = await fetch(`${operatorUrl}/agents`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      agents: Array<{
        tokenId: string;
        ticker: string;
        description: string;
        model: string;
        perCallSmallest: string;
        perCallHuman: string;
        runtime: "openai-compat" | "hermes";
      }>;
    };
    return body.agents.map((a) => ({
      ticker: a.ticker,
      ens: `${a.ticker.toLowerCase()}.permissionless`,
      tokenId: BigInt(a.tokenId),
      perCallUsdc: BigInt(a.perCallSmallest),
      perCallHuman: a.perCallHuman,
      pricePerShareUsdc: 0n,
      cumulativeRevenueUsdc: 0n,
      callsToday: 0,
      runtime: a.runtime,
      permissionless: true as const,
    }));
  } catch {
    return [];
  }
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
  const resolved = await resolveAgentForReads(ticker);
  if (!resolved) return null;

  // Static agents have rich off-chain metadata; dynamic agents carry their
  // metadata on the resolved record (operator-supplied).
  const staticMeta = AGENT_METADATA[resolved.ticker];

  // Dynamic agents that haven't run deploy-finance: return a minimal stub
  // so the page renders without 404. UI gracefully shows zeros for IPO/etc.
  if (resolved.isDynamic && !resolved.hasFinance) {
    return {
      ticker: resolved.ticker,
      ens: resolved.ens,
      tokenId: resolved.tokenId,
      perCallUsdc: resolved.perCallUsdc ?? 0n,
      perCallHuman: resolved.perCallHuman ?? "$0.00",
      pricePerShareUsdc: 0n,
      cumulativeRevenueUsdc: 0n,
      callsToday: 0,
      runtime: resolved.runtime,
      name: resolved.ticker.toLowerCase(),
      description: resolved.description ?? "Permissionless agent — shares not yet deployed.",
      modelBase: resolved.modelBase ?? "(unknown)",
      expectedTeeMeasurement: ("0x" + "00".repeat(32)) as Hex,
      ipo: {
        pricePerShareUsdc: 0n,
        sold: 0n,
        allocation: 0n,
        totalSupply: 0n,
        startsAt: 0,
        endsAt: 0,
        isOpen: false,
      },
      contracts: {
        iNFT: ZG_GALILEO.agentNft,
        shareToken: resolved.shareToken,
        vault: resolved.revenueVault,
        ipoSale: resolved.ipoSale,
        marketplace: ZG_GALILEO.marketplace,
        agentRegistry: ZG_GALILEO.agentRegistry,
      },
      bestBid: null,
      ...(resolved.realAgent ? { realAgent: resolved.realAgent } : {}),
    };
  }

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
      address: resolved.ipoSale,
      abi: ipoSaleAbi,
      functionName: "pricePerShare",
    }),
    basePublicClient.readContract({
      address: resolved.ipoSale,
      abi: ipoSaleAbi,
      functionName: "sold",
    }),
    basePublicClient.readContract({
      address: resolved.ipoSale,
      abi: ipoSaleAbi,
      functionName: "maxShares",
    }),
    basePublicClient.readContract({
      address: resolved.ipoSale,
      abi: ipoSaleAbi,
      functionName: "startsAt",
    }),
    basePublicClient.readContract({
      address: resolved.ipoSale,
      abi: ipoSaleAbi,
      functionName: "endsAt",
    }),
    basePublicClient.readContract({
      address: resolved.ipoSale,
      abi: ipoSaleAbi,
      functionName: "isOpen",
    }),
    basePublicClient.readContract({
      address: resolved.shareToken,
      abi: shareTokenAbi,
      functionName: "totalSupply",
    }),
    // Marketplace bids only exist for static agents — the marketplace is
    // keyed by tokenId on 0G Galileo, and dynamic iNFTs DO have a real
    // tokenId, so the read is safe; it'll just return empty for unbid agents.
    zgPublicClient.readContract({
      address: ZG_GALILEO.marketplace,
      abi: marketplaceAbi,
      functionName: "getBid",
      args: [resolved.tokenId],
    }).catch(() => ({
      bidder: "0x0000000000000000000000000000000000000000" as Hex,
      price: 0n,
      expiresAt: 0n,
      bidderPubkey: "0x" as Hex,
    })),
  ]);

  const snapshots = await loadSnapshots(resolved.ticker).catch(() => []);
  const cumulativeRevenueUsdc = snapshots.reduce(
    (acc, s) => acc + s.totalDistributedUsdc,
    0n,
  );
  const callsToday = await callsInLastNSeconds(resolved.ticker, SECONDS_PER_DAY).catch(
    () => 0,
  );

  const zeroBid = bestBidRaw.bidder === "0x0000000000000000000000000000000000000000";
  return {
    ticker: resolved.ticker,
    ens: resolved.ens,
    tokenId: resolved.tokenId,
    perCallUsdc: staticMeta?.perCallUsdc ?? resolved.perCallUsdc ?? 0n,
    perCallHuman: staticMeta?.perCallHuman ?? resolved.perCallHuman ?? "$0.00",
    pricePerShareUsdc: pricePerShare,
    cumulativeRevenueUsdc,
    callsToday,
    runtime: resolved.runtime,
    name: staticMeta?.name ?? resolved.ticker.toLowerCase(),
    description: staticMeta?.description ?? resolved.description ?? "",
    modelBase: staticMeta?.modelBase ?? resolved.modelBase ?? "(unknown)",
    expectedTeeMeasurement:
      staticMeta?.expectedTeeMeasurement ?? (("0x" + "00".repeat(32)) as Hex),
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
      shareToken: resolved.shareToken,
      vault: resolved.revenueVault,
      ipoSale: resolved.ipoSale,
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
    ...(resolved.realAgent ? { realAgent: resolved.realAgent } : {}),
  };
}

/**
 * Walks Transfer events on the ShareToken to derive current holder balances.
 * Public RPCs cap getLogs at ~50k blocks per call, so we paginate from the
 * agent's deploy block to head. Once @stratum/indexer ships, replace with a
 * single REST call.
 */
export async function loadHolders(ticker: string): Promise<Holder[]> {
  const resolved = await resolveAgentForReads(ticker);
  if (!resolved || !resolved.hasFinance) return [];

  const transferEvent = shareTokenAbi.find(
    (e) => e.type === "event" && e.name === "Transfer",
  ) as never;

  const balances = new Map<Hex, bigint>();
  const head = await basePublicClient.getBlockNumber();
  const STEP = 45_000n; // safely under the 50k publicnode cap

  for (let from = resolved.baseDeployBlock; from <= head; from += STEP + 1n) {
    const to = from + STEP > head ? head : from + STEP;
    const logs = await basePublicClient.getLogs({
      address: resolved.shareToken,
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
  const resolved = await resolveAgentForReads(ticker);
  if (!resolved || !resolved.hasFinance) return [];

  const count = await basePublicClient.readContract({
    address: resolved.revenueVault,
    abi: revenueVaultAbi,
    functionName: "snapshotCount",
  });

  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const rows = await Promise.all(
    ids.map((id) =>
      basePublicClient.readContract({
        address: resolved.revenueVault,
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
  const resolved = await resolveAgentForReads(ticker);
  if (!resolved) return [];

  try {
    const res = await fetch(`${operatorUrl}/receipts?tokenId=${resolved.tokenId}`, {
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
