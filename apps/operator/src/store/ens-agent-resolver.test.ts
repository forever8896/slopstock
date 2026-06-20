/**
 * Tests for ens-agent-resolver.ts (resolveAgent + verifyAgent)
 *
 * Strategy: we mock the viem `createPublicClient` so no live RPC calls are made.
 * This gives us full control over the resolver responses and covers both
 * the verified and failure branches of ENSIP-25 without any chain state.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { resolveAgent, verifyAgent } from "./ens-agent-resolver.ts";
import * as viemModule from "viem";

// ─── Mock setup ────────────────────────────────────────────────────────────────

type MockTextStore = Record<string, Record<string, string>>; // node → key → value
type MockAddrStore = Record<string, string>; // node → address

let mockTextStore: MockTextStore = {};
let mockAddrStore: MockAddrStore = {};

// Mock createPublicClient to intercept readContract calls
const originalCreatePublicClient = viemModule.createPublicClient;

function buildMockClient() {
  return {
    readContract: async (args: {
      functionName: string;
      args: unknown[];
    }) => {
      const { functionName, args: fnArgs } = args;
      if (functionName === "text") {
        const node = fnArgs[0] as string;
        const key = fnArgs[1] as string;
        return mockTextStore[node]?.[key] ?? "";
      }
      if (functionName === "addr") {
        const node = fnArgs[0] as string;
        return mockAddrStore[node] ?? "0x0000000000000000000000000000000000000000";
      }
      throw new Error(`unexpected readContract call: ${functionName}`);
    },
  };
}

// We need to monkey-patch at the module level since we can't inject the client.
// Instead, test via a thin wrapper that accepts an injected client — but since
// the module doesn't expose that, we intercept the real Sepolia RPC calls by
// pointing rpcUrl at a mock server, OR we test the integration contract with
// a live Sepolia node for the "live" path and use a stub mock for unit tests.
//
// For deterministic unit tests without live RPC, we use bun:test mock to patch
// the module-level `createPublicClient` import.

// ─── Unit tests with mocked resolver (no live RPC) ────────────────────────────
//
// Note: since `ens-agent-resolver.ts` calls `createPublicClient` at runtime
// (not at import time), we need a different strategy than module mocking.
// We create an integration test harness that validates the module's logic
// through the actual public API but with a controlled mock HTTP server that
// responds to JSON-RPC calls.

// HTTP JSON-RPC mock server using Bun
import { Server } from "bun";

/**
 * Start a local JSON-RPC mock server that returns pre-configured responses
 * for eth_call (readContract). The responses map "functionSig+args" → result.
 */
function startMockRpcServer(
  responses: Array<{
    /** Substring to match against the encoded calldata hex */
    matchCalldata: string;
    /** ABI-encoded return value (hex) */
    result: string;
  }>
): { server: Server<undefined>; url: string } {
  const server = Bun.serve({
    port: 0, // random available port
    async fetch(req) {
      const body = (await req.json()) as { method: string; params: unknown[] };
      if (body.method === "eth_chainId") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" }); // Sepolia
      }
      if (body.method === "eth_call") {
        const callParams = body.params[0] as { data?: string };
        const calldata = (callParams?.data ?? "").toLowerCase();
        for (const r of responses) {
          if (calldata.includes(r.matchCalldata.toLowerCase())) {
            return Response.json({ jsonrpc: "2.0", id: 1, result: r.result });
          }
        }
        // Default: return empty string (ABI-encoded as offset + length=0)
        return Response.json({
          jsonrpc: "2.0", id: 1,
          result: "0x" +
            "0000000000000000000000000000000000000000000000000000000000000020" + // offset
            "0000000000000000000000000000000000000000000000000000000000000000",  // length=0
        });
      }
      // For block number, net_version etc.
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x0" });
    },
  });
  return { server, url: `http://localhost:${server.port}` };
}

/** ABI-encode a non-empty string response (text() → string) */
function encodeStringResponse(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const len = bytes.length;
  const padded = new Uint8Array(Math.ceil(len / 32) * 32);
  padded.set(bytes);
  const offset = "0000000000000000000000000000000000000000000000000000000000000020";
  const length = len.toString(16).padStart(64, "0");
  const data = Array.from(padded).map(b => b.toString(16).padStart(2, "0")).join("");
  return "0x" + offset + length + data;
}

/** ABI-encode an empty string response */
function encodeEmptyString(): string {
  return "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000000";
}

/** ABI-encode an address response */
function encodeAddress(addr: string): string {
  const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
  return "0x" + clean.padStart(64, "0");
}

// ─── resolveAgent tests ────────────────────────────────────────────────────────

describe("resolveAgent", () => {
  test("returns null fields when all records are empty", async () => {
    // Mock RPC that returns empty for everything.
    // addr(bytes32) returns the zero address → our resolver returns null.
    const zeroAddrEncoded = "0x" + "0".repeat(64); // padded zero address
    const { server, url } = startMockRpcServer([
      {
        matchCalldata: "3b3b57de", // addr(bytes32) selector
        result: zeroAddrEncoded,
      },
    ]);
    try {
      const result = await resolveAgent("auditor.slopstock.eth", {
        network: "sepolia",
        rpcUrl: url,
      });
      expect(result.ensName).toBe("auditor.slopstock.eth");
      expect(result.agentContext).toBeNull();
      expect(result.endpointX402).toBeNull();
      expect(result.endpointMcp).toBeNull();
      expect(result.endpointWeb).toBeNull();
      expect(result.vaultAddress).toBeNull();
    } finally {
      server.stop(true);
    }
  });

  test("returns agent-context when record is present", async () => {
    // The text() function selector is 0x59d1d43c
    // We match on it to intercept the agent-context call
    // Since we can't easily distinguish by key in the mock (calldata encoding
    // includes the key string), we return the same value for all text() calls.
    const agentContextValue = "Solidity security auditor specialized in DeFi protocols";
    const { server, url } = startMockRpcServer([
      {
        matchCalldata: "59d1d43c", // text(bytes32,string) selector
        result: encodeStringResponse(agentContextValue),
      },
    ]);
    try {
      const result = await resolveAgent("auditor.slopstock.eth", {
        network: "sepolia",
        rpcUrl: url,
      });
      // At least one of the text fields should be populated
      const hasContent =
        result.agentContext !== null ||
        result.endpointX402 !== null ||
        result.endpointMcp !== null ||
        result.endpointWeb !== null;
      expect(hasContent).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("returns vault address when addr record is set", async () => {
    const vaultAddr = "0x67826ded1ff988eb2711b5ad6bd2752a311893b9";
    const { server, url } = startMockRpcServer([
      {
        matchCalldata: "3b3b57de", // addr(bytes32) selector
        result: encodeAddress(vaultAddr),
      },
    ]);
    try {
      const result = await resolveAgent("auditor.slopstock.eth", {
        network: "sepolia",
        rpcUrl: url,
      });
      expect(result.vaultAddress?.toLowerCase()).toBe(vaultAddr.toLowerCase());
    } finally {
      server.stop(true);
    }
  });
});

// ─── verifyAgent (ENSIP-25) tests ─────────────────────────────────────────────

describe("verifyAgent (ENSIP-25)", () => {
  test("verified=true when text record is non-empty", async () => {
    const { server, url } = startMockRpcServer([
      {
        matchCalldata: "59d1d43c", // text(bytes32,string)
        result: encodeStringResponse("1"),
      },
    ]);
    try {
      const result = await verifyAgent(
        "auditor.slopstock.eth",
        "0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432",
        "1",
        { network: "sepolia", rpcUrl: url },
      );
      expect(result.verified).toBe(true);
      expect(result.recordValue).toBe("1");
      expect(result.reason).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("verified=false when text record is empty (ENSIP-25 MUST fail)", async () => {
    const { server, url } = startMockRpcServer([
      // No matches → always returns empty string
    ]);
    try {
      const result = await verifyAgent(
        "auditor.slopstock.eth",
        "0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432",
        "1",
        { network: "sepolia", rpcUrl: url },
      );
      expect(result.verified).toBe(false);
      expect(result.recordValue).toBe("");
      expect(result.reason).toContain("ENSIP-25");
    } finally {
      server.stop(true);
    }
  });

  test("verified=false on resolver error", async () => {
    // Point at a port that refuses connections
    const result = await verifyAgent(
      "auditor.slopstock.eth",
      "0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432",
      "1",
      { network: "sepolia", rpcUrl: "http://127.0.0.1:19999" }, // nothing listening
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/resolver error/i);
  });

  test("key format is correct: agent-registration[<interopAddr>][<agentId>]", async () => {
    const interopAddr = "0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432";
    const agentId = "42";
    const { server, url } = startMockRpcServer([]);
    try {
      const result = await verifyAgent(
        "auditor.slopstock.eth",
        interopAddr,
        agentId,
        { network: "sepolia", rpcUrl: url },
      );
      expect(result.key).toBe(`agent-registration[${interopAddr}][${agentId}]`);
    } finally {
      server.stop(true);
    }
  });

  test("verified=true when record value is '1' (spec-recommended sentinel)", async () => {
    const { server, url } = startMockRpcServer([
      {
        matchCalldata: "59d1d43c",
        result: encodeStringResponse("1"),
      },
    ]);
    try {
      const result = await verifyAgent(
        "oracles.slopstock.eth",
        "0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432",
        "3",
        { network: "sepolia", rpcUrl: url },
      );
      expect(result.verified).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("verified=false after record is removed (demonstrates attestation revocation)", async () => {
    // First call: record exists → verified
    const { server: s1, url: u1 } = startMockRpcServer([
      { matchCalldata: "59d1d43c", result: encodeStringResponse("1") },
    ]);
    const r1 = await verifyAgent("auditor.slopstock.eth", "0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432", "1", { rpcUrl: u1 });
    s1.stop(true);
    expect(r1.verified).toBe(true);

    // Second call: record removed → must fail
    const { server: s2, url: u2 } = startMockRpcServer([]); // no records
    const r2 = await verifyAgent("auditor.slopstock.eth", "0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432", "1", { rpcUrl: u2 });
    s2.stop(true);
    expect(r2.verified).toBe(false);
    expect(r2.reason).toContain("ENSIP-25");
  });
});

// ─── Integration smoke test (key generation) ──────────────────────────────────

describe("verifyAgent key construction with real ERC-7930 encoding", () => {
  test("key uses the same interop address as encodeInteropAddress would produce", async () => {
    // Import the encoder to verify consistency
    const { encodeInteropAddress, CHAIN_TYPE_EIP155 } = await import("../../../../packages/shared/src/erc7930.ts");
    const registryAddr = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as `0x${string}`;
    const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, 8453n, registryAddr);

    const { server, url } = startMockRpcServer([
      { matchCalldata: "59d1d43c", result: encodeStringResponse("1") },
    ]);
    try {
      const result = await verifyAgent("auditor.slopstock.eth", interopAddr, "1", { rpcUrl: url });
      expect(result.key).toBe(`agent-registration[${interopAddr}][1]`);
      expect(result.verified).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
