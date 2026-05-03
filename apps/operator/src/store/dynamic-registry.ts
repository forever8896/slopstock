/**
 * Dynamic agent registry — agents minted permissionlessly via the /launch
 * page register here so the operator can serve them immediately without
 * an env restart.
 *
 * Persisted to AGENTS_DATA_DIR/registry.json. In-memory cache is the
 * source of truth at runtime; disk is only for survival across restarts.
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface DynamicAgent {
  tokenId: string;
  ticker: string;
  description: string;
  systemPrompt: string;
  /** OpenAI-compat model id to use for this agent's inferences. */
  model: string;
  /** Smallest-unit USDC per call, e.g. "500000" for $0.50. */
  perCallSmallest: string;
  perCallHuman: string;
  runtime: "openai-compat" | "hermes";
  creator: string;
  txHash: string;
  createdAt: number;
  /** Populated by the finance-deploy step (POST /agents/:tokenId/deploy-finance). */
  finance?: {
    shareToken: string;
    revenueVault: string;
    ipoSale: string;
    pricePerShareUsd: string;
    maxShares: string;
    deployedAt: number;
  };
}

import { setDynamicSnapshot } from "../runtime/dynamic-cache.ts";

let registryPath: string | null = null;
const cache = new Map<string, DynamicAgent>();
let loaded = false;

function configurePath(dataDir: string) {
  if (registryPath) return;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  registryPath = join(dataDir, "registry.json");
}

async function ensureLoaded(): Promise<void> {
  if (loaded || !registryPath) return;
  loaded = true;
  if (!existsSync(registryPath)) {
    setDynamicSnapshot(new Map(cache));
    return;
  }
  try {
    const raw = await readFile(registryPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, DynamicAgent>;
    for (const [k, v] of Object.entries(parsed)) cache.set(k, v);
    console.log(`[dynamic-registry] loaded ${cache.size} agents from ${registryPath}`);
  } catch (err) {
    console.warn(`[dynamic-registry] failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }
  setDynamicSnapshot(new Map(cache));
}

async function flush(): Promise<void> {
  if (!registryPath) return;
  if (!existsSync(dirname(registryPath))) {
    mkdirSync(dirname(registryPath), { recursive: true });
  }
  const obj: Record<string, DynamicAgent> = {};
  for (const [k, v] of cache) obj[k] = v;
  await writeFile(registryPath, JSON.stringify(obj, null, 2), "utf-8");
}

export function initRegistry(dataDir: string): void {
  configurePath(dataDir);
}

export async function getDynamicAgent(tokenIdOrString: bigint | string): Promise<DynamicAgent | null> {
  await ensureLoaded();
  const key = typeof tokenIdOrString === "string" ? tokenIdOrString : tokenIdOrString.toString();
  return cache.get(key) ?? null;
}

export async function listDynamicAgents(): Promise<DynamicAgent[]> {
  await ensureLoaded();
  return [...cache.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function registerDynamicAgent(input: DynamicAgent): Promise<void> {
  await ensureLoaded();
  cache.set(input.tokenId, input);
  setDynamicSnapshot(new Map(cache));
  await flush();
  console.log(`[dynamic-registry] registered tokenId=${input.tokenId} ticker=${input.ticker} model=${input.model}`);
}

export async function attachFinance(
  tokenId: string,
  finance: NonNullable<DynamicAgent["finance"]>,
): Promise<DynamicAgent | null> {
  await ensureLoaded();
  const existing = cache.get(tokenId);
  if (!existing) return null;
  const updated: DynamicAgent = { ...existing, finance };
  cache.set(tokenId, updated);
  setDynamicSnapshot(new Map(cache));
  await flush();
  console.log(
    `[dynamic-registry] tokenId=${tokenId} finance: share=${finance.shareToken} vault=${finance.revenueVault} ipo=${finance.ipoSale}`,
  );
  return updated;
}
