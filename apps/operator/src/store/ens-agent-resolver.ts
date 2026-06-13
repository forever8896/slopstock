/**
 * ENS Agent Resolver + ENSIP-25 Verifier
 *
 * Implements:
 *   - resolveAgent(ensName)  — reads ENSIP-26 records (agent-context, endpoints)
 *   - verifyAgent(ensName, registryInteropAddr, agentId) — ENSIP-25 check
 *
 * ENSIP-25 verification algorithm (mandatory):
 *   1. Construct key: `agent-registration[<registryInteropAddr>][<agentId>]`
 *   2. Read text(node, key) from the ENS resolver
 *   3. Non-empty value = verified
 *   4. Empty / missing / resolver-error = MUST FAIL
 *
 * This is pure read logic — no funded transactions required. Fully testable
 * against live Sepolia or with a mocked resolver.
 *
 * Network selection mirrors ens-subname.ts: "mainnet" | "sepolia", defaulting
 * to "sepolia" so testnet remains the safe default.
 */

import {
  createPublicClient,
  http,
  namehash,
} from "viem";
import { sepolia, mainnet } from "viem/chains";
import type { Hex } from "viem";

// ─── Resolver addresses ────────────────────────────────────────────────────────

const PUBLIC_RESOLVER_SEPOLIA: Hex = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const PUBLIC_RESOLVER_MAINNET: Hex = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41";

const publicResolverTextAbi = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ResolvedAgent {
  /** The ENS name that was resolved. */
  ensName: string;
  /** Value of `agent-context` text record — the agent's description/index. */
  agentContext: string | null;
  /** Value of `agent-endpoint[x402]` — the x402 paywall endpoint URL. */
  endpointX402: string | null;
  /** Value of `agent-endpoint[mcp]` — the MCP endpoint URL. */
  endpointMcp: string | null;
  /** Value of `agent-endpoint[web]` — the human-facing web URL. */
  endpointWeb: string | null;
  /** ETH addr record (vault address). */
  vaultAddress: Hex | null;
}

export interface AgentResolverOpts {
  /** "mainnet" | "sepolia". Defaults to "sepolia". */
  network?: "mainnet" | "sepolia";
  /** Override RPC URL. Falls back to public endpoints. */
  rpcUrl?: string;
}

export interface VerifyAgentResult {
  /** Whether ENSIP-25 verification passed. */
  verified: boolean;
  /** The text record key that was checked. */
  key: string;
  /** The raw value returned by the resolver (empty string if missing). */
  recordValue: string;
  /** Human-readable reason (present when verified=false). */
  reason?: string;
}

// ─── resolveAgent ──────────────────────────────────────────────────────────────

/**
 * Read ENSIP-26 text records from an ENS name.
 *
 * Returns all agent-related text records and the addr record (vault address).
 * Missing records are `null` — callers should decide whether a missing record
 * is an error (e.g. no x402 endpoint = cannot pay).
 *
 * Read-only — no gas required.
 */
export async function resolveAgent(
  ensName: string,
  opts?: AgentResolverOpts,
): Promise<ResolvedAgent> {
  const { publicClient, resolver } = makeClient(opts);
  const node = namehash(ensName.toLowerCase());

  async function readText(key: string): Promise<string | null> {
    try {
      const val = (await publicClient.readContract({
        address: resolver,
        abi: publicResolverTextAbi,
        functionName: "text",
        args: [node, key],
      })) as string;
      return val === "" ? null : val;
    } catch {
      return null;
    }
  }

  async function readAddr(): Promise<Hex | null> {
    try {
      const addr = (await publicClient.readContract({
        address: resolver,
        abi: publicResolverTextAbi,
        functionName: "addr",
        args: [node],
      })) as Hex;
      if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;
      return addr;
    } catch {
      return null;
    }
  }

  const [agentContext, endpointX402, endpointMcp, endpointWeb, vaultAddress] = await Promise.all([
    readText("agent-context"),
    readText("agent-endpoint[x402]"),
    readText("agent-endpoint[mcp]"),
    readText("agent-endpoint[web]"),
    readAddr(),
  ]);

  return {
    ensName,
    agentContext,
    endpointX402,
    endpointMcp,
    endpointWeb,
    vaultAddress,
  };
}

// ─── verifyAgent (ENSIP-25) ────────────────────────────────────────────────────

/**
 * Verify an agent identity claim using ENSIP-25.
 *
 * Flow (mandated by ENSIP-25):
 *   1. Construct key: `agent-registration[<registryInteropAddr>][<agentId>]`
 *   2. Read text(node, key) from the resolver of the claimed ENS name
 *   3. Non-empty value → verified=true
 *   4. Empty / missing / resolver-error → verified=false (MUST FAIL)
 *
 * @param ensName              The ENS name the agent claims to own
 * @param registryInteropAddr  ERC-7930 interoperable address of the registry
 *                             (use encodeInteropAddress from erc7930.ts)
 * @param agentId              The agent's tokenId / id string in that registry
 * @param opts                 Network + RPC options
 */
export async function verifyAgent(
  ensName: string,
  registryInteropAddr: string,
  agentId: string,
  opts?: AgentResolverOpts,
): Promise<VerifyAgentResult> {
  const key = `agent-registration[${registryInteropAddr}][${agentId}]`;
  const { publicClient, resolver } = makeClient(opts);
  const node = namehash(ensName.toLowerCase());

  let recordValue = "";
  try {
    const raw = (await publicClient.readContract({
      address: resolver,
      abi: publicResolverTextAbi,
      functionName: "text",
      args: [node, key],
    })) as string;
    recordValue = raw ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verified: false,
      key,
      recordValue: "",
      reason: `resolver error: ${msg.slice(0, 200)}`,
    };
  }

  if (recordValue === "") {
    return {
      verified: false,
      key,
      recordValue: "",
      reason: "ENSIP-25: text record is empty or missing — verification MUST fail",
    };
  }

  return {
    verified: true,
    key,
    recordValue,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function makeClient(opts?: AgentResolverOpts): {
  publicClient: ReturnType<typeof createPublicClient>;
  resolver: Hex;
} {
  const network = opts?.network ?? "sepolia";
  const isMainnet = network === "mainnet";
  const chain = isMainnet ? mainnet : sepolia;
  const resolver = isMainnet ? PUBLIC_RESOLVER_MAINNET : PUBLIC_RESOLVER_SEPOLIA;
  const defaultRpc = isMainnet
    ? "https://eth.llamarpc.com"
    : "https://ethereum-sepolia-rpc.publicnode.com";
  const rpcUrl = opts?.rpcUrl ?? defaultRpc;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  return { publicClient, resolver };
}
