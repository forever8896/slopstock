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

import type { AgentManifest } from "@stratum/shared";

export interface DynamicAgent {
  tokenId: string;
  ticker: string;
  description: string;
  systemPrompt: string;
  /** OpenAI-compat model id (Venice). For backend === "0g-compute" this is
   *  informational only — the actual model is determined by the provider's
   *  TeeML attestation at call time. */
  model: string;
  /** Smallest-unit USDC per call, e.g. "500000" for $0.50. */
  perCallSmallest: string;
  perCallHuman: string;
  runtime: "openai-compat" | "hermes";
  /** Compute backend for this agent's inferences.
   *    "openai-compat" → Venice (or any OpenAI-shaped HTTP endpoint)
   *    "0g-compute"    → 0G Compute Network broker, TeeML-verified sealed inference
   *  Optional for backward-compat with v1 dynamic agents (default openai-compat). */
  backend?: "openai-compat" | "0g-compute";
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
  // ─── Manifest fields (set when the agent was minted with a real-agent
  //     bundle on 0G Storage). Optional for backward compat with v1 dynamic
  //     agents. See docs/12-real-agent-launch.md. ────────────────────────
  /** keccak256 of canonical(manifest), no `0x` prefix. Equals iNFT.metadataHash. */
  bundleManifestCid?: string;
  /** Capability template id (e.g. "cross-agent-orchestrator"). Surfaced in UI. */
  templateId?: string;
  /** Runtime tier picked at mint. Routes to openai-compat | tools-lite | hermes. */
  runtimeTier?: "openai-compat" | "tools-lite" | "hermes";
  /** Defensive copy of the full manifest. Used when 0G Storage pull fails;
   *  also lets the operator survive cold-cache restarts without re-fetching. */
  manifestShadow?: AgentManifest;
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
