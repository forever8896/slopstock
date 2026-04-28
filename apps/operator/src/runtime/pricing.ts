/**
 * Per-tokenId pricing.
 *
 * Per-call price isn't on chain — it's an operator policy decision. We track
 * it here keyed by tokenId. The MCP tools.ts PRICING_BY_TICKER table imports
 * from here so the two stay in sync.
 */

export interface AgentPricing {
  perCallSmallest: string; // smallest unit of USDC, e.g. "1000000" for $1
  perCallHuman: string;
  modelBase: string;
  description: string;
  ticker: string;
}

const PRICING_BY_TOKEN: Record<string, AgentPricing> = {
  "1": {
    ticker: "AUDIT",
    perCallSmallest: "1000000",
    perCallHuman: "$1.00",
    modelBase: "qwen2.5-coder-32b + audit-lora-v1 (sealed) — Hermes pattern",
    description:
      "Sealed Solidity audit agent. Pay 1 USDC, get a structured audit with TEE-attested provenance. Hermes-pattern runtime — tools, persistent memory, autonomous skill creation.",
  },
  "2": {
    ticker: "MEMER",
    perCallSmallest: "500000",
    perCallHuman: "$0.50",
    modelBase: "qwen2.5-coder-7b (raw) — openai-compat runtime",
    description:
      "Quick ruggability check for meme-token contracts. Single-shot raw-model agent — no tools, no memory.",
  },
  "3": {
    ticker: "ORCL",
    perCallSmallest: "100000",
    perCallHuman: "$0.10",
    modelBase: "qwen2.5-coder-7b (raw) — openai-compat runtime",
    description:
      "Price oracle agent. Pay 0.10 USDC, get a Chainlink-backed USD price for any major token. Designed to be called by other agents during audits.",
  },
};

const FALLBACK: AgentPricing = {
  ticker: "UNKNOWN",
  perCallSmallest: "1000000",
  perCallHuman: "$1.00",
  modelBase: "(unconfigured)",
  description: "Unconfigured agent.",
};

export function priceForToken(tokenId: bigint): AgentPricing {
  return PRICING_BY_TOKEN[tokenId.toString()] ?? FALLBACK;
}

/** Map ticker → tokenId for places that still want to look up by ticker. */
export function tokenIdForTicker(ticker: string): bigint | null {
  const upper = ticker.toUpperCase();
  for (const [k, v] of Object.entries(PRICING_BY_TOKEN)) {
    if (v.ticker === upper) return BigInt(k);
  }
  return null;
}

export const ALL_PRICINGS = PRICING_BY_TOKEN;
