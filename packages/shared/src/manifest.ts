/**
 * Agent manifest — the content-addressable bundle that defines a permissionless
 * agent at mint time.
 *
 * The whole manifest is canonicalized + hashed; that hash is committed on chain
 * as the iNFT's `metadataHash`. The manifest body itself is pinned to 0G
 * Storage; the iNFT's `metadataURI` is `0g-storage://<rootHash>`.
 *
 * Tampering with any tool, pattern, or skill listed in the manifest changes
 * the manifest hash, which mismatches the chain commit — the operator refuses
 * to serve the agent. That's the iNFT story end-to-end.
 *
 * See docs/12-real-agent-launch.md §4 for the full design.
 */

import { keccak256, toHex } from "viem";

import type { Hex } from "./addresses";
import type { CapabilityTemplateId, RuntimeTier, ToolName } from "./templates";

/** What gets pinned to 0G Storage. The iNFT's metadataHash binds this. */
export interface AgentManifest {
  schemaVersion: "stratum/agent-manifest@1";
  identity: {
    ticker: string;                  // upper-case
    name: string;                    // human label
    description: string;
    creator: Hex;                    // wallet that minted
  };
  brain: {
    templateId: CapabilityTemplateId;
    /** Final system prompt — possibly user-edited from the template baseline. */
    systemPrompt: string;
    /** Venice model id, or "0g-tee-provider-served" when backend is 0g-compute. */
    model: string;
    backend: "openai-compat" | "0g-compute";
    runtimeTier: RuntimeTier;
  };
  capabilities: {
    /** Tools the runtime is allowed to expose to the LLM. */
    tools: ToolName[];
    /** Pattern markdowns embedded inline (small files, ≤8kB each). */
    patterns: { name: string; body: string }[];
    /** Skill markdowns embedded inline. */
    skills: { name: string; body: string }[];
  };
  pricing: {
    /** USDC, smallest unit (e.g. "100000" for 0.10 USDC). */
    perCallSmallest: string;
    perCallHuman: string;
  };
  meta: {
    createdAt: number;               // unix seconds at mint
    /** Optional URL hint for where this agent is served — operators can ignore. */
    operatorHint?: string;
  };
}

/**
 * Deterministic JSON canonicalization: sorted keys at every depth, no
 * insignificant whitespace, no trailing newline.
 *
 * Two parties hashing the same logical manifest must produce the same bytes,
 * regardless of the order of fields in their input. Same algorithm runs in the
 * browser (mint) and in the operator (verify), so they MUST agree.
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = canonicalize(obj[k]);
    }
    return out;
  }
  return value;
}

/** keccak256 of canonical(manifest). This is what goes on-chain as metadataHash. */
export function computeManifestHash(manifest: AgentManifest): Hex {
  const bytes = new TextEncoder().encode(canonicalizeJson(manifest));
  return keccak256(toHex(bytes));
}

/**
 * Lightweight runtime check — no Zod dep here. Returns `null` on success,
 * or a short error string. Operator uses this on `/agents/register` before
 * accepting a manifest from the browser.
 */
export function validateManifest(m: unknown): string | null {
  if (!m || typeof m !== "object") return "manifest is not an object";
  const r = m as Record<string, unknown>;
  if (r["schemaVersion"] !== "stratum/agent-manifest@1") {
    return `schemaVersion must be "stratum/agent-manifest@1"`;
  }
  const id = r["identity"] as Record<string, unknown> | undefined;
  if (!id) return "identity missing";
  for (const k of ["ticker", "name", "description", "creator"]) {
    if (typeof id[k] !== "string" || (id[k] as string).length === 0) {
      return `identity.${k} required`;
    }
  }
  const b = r["brain"] as Record<string, unknown> | undefined;
  if (!b) return "brain missing";
  for (const k of ["templateId", "systemPrompt", "model", "backend", "runtimeTier"]) {
    if (typeof b[k] !== "string") return `brain.${k} required`;
  }
  if (b["backend"] !== "openai-compat" && b["backend"] !== "0g-compute") {
    return "brain.backend must be openai-compat or 0g-compute";
  }
  if (
    b["runtimeTier"] !== "openai-compat" &&
    b["runtimeTier"] !== "tools-lite" &&
    b["runtimeTier"] !== "hermes"
  ) {
    return "brain.runtimeTier must be openai-compat | tools-lite | hermes";
  }
  const cap = r["capabilities"] as Record<string, unknown> | undefined;
  if (!cap) return "capabilities missing";
  if (!Array.isArray(cap["tools"])) return "capabilities.tools must be array";
  if (!Array.isArray(cap["patterns"])) return "capabilities.patterns must be array";
  if (!Array.isArray(cap["skills"])) return "capabilities.skills must be array";
  const pr = r["pricing"] as Record<string, unknown> | undefined;
  if (!pr) return "pricing missing";
  if (typeof pr["perCallSmallest"] !== "string") return "pricing.perCallSmallest required";
  return null;
}
