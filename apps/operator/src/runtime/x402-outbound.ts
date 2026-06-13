/**
 * Outbound x402 v2 — an agent autonomously PAYING external x402 services
 * (Exa search, CoinGecko prices) mid-task. The "outbound leg" of the payment
 * triangle: strangers' services, paid from the agent's own wallet.
 *
 * Same proven client path as scripts/pay-real-operator.ts, packaged for the
 * agent loop. Registers both mainnet and testnet so one pay-fetch can hit our
 * own testnet endpoints (verification) or real mainnet services (Exa/CoinGecko).
 *
 * NOTE: Exa/CoinGecko x402 endpoints live on Base MAINNET — paying them for
 * real needs USDC in the agent wallet on mainnet (~$1 = 100+ calls).
 */

import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { PrivateKeyAccount } from "viem/accounts";

export type PayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Wrap fetch so the agent's wallet auto-pays any x402 challenge (Base main+test). */
export function createAgentPayFetch(account: PrivateKeyAccount): PayFetch {
  const signer = toClientEvmSigner(account);
  const client = new x402Client()
    .register("eip155:8453", new ExactEvmScheme(signer)) // Base mainnet (Exa, CoinGecko)
    .register("eip155:84532", new ExactEvmScheme(signer)); // Base Sepolia (our endpoints)
  return wrapFetchWithPayment(fetch, client);
}

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

/** Pay Exa ($0.007) for a neural web search. Returns parsed hits. */
export async function exaSearch(payFetch: PayFetch, query: string, numResults = 3): Promise<SearchHit[]> {
  const res = await payFetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, numResults, contents: { text: { maxCharacters: 500 } } }),
  });
  if (!res.ok) throw new Error(`exa search failed: ${res.status} ${(await res.text()).slice(0, 120)}`);
  return parseExaResults(await res.json());
}

/** Parse Exa's response shape into SearchHits (separated for testability). */
export function parseExaResults(data: unknown): SearchHit[] {
  const results = (data as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      title: String(o["title"] ?? "(untitled)"),
      url: String(o["url"] ?? ""),
      snippet: typeof o["text"] === "string" ? (o["text"] as string).slice(0, 300) : undefined,
    };
  });
}

/** Render hits into a compact block for the agent's tool output. */
export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No results.";
  return hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ""}`)
    .join("\n");
}
