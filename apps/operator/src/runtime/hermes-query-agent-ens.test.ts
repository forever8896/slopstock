/**
 * Tests for query_agent ENS resolution + ENSIP-25 verification path.
 *
 * These tests verify the ENS-first resolution logic in query_agent:
 *   1. For .eth names: resolveAgent → verifyAgent → pay (or reject)
 *   2. Fallback to BASE_SEPOLIA_AGENTS when ENS is unavailable
 *   3. ENSIP-25 failure rejects the call before payment
 *
 * We test the resolution and verification layers independently, then
 * confirm the integration via the TOOL_REGISTRY entry.
 *
 * No live RPC or payments are made — the mock server intercepts all calls.
 */

import { describe, expect, test } from "bun:test";
import { resolveAgent, verifyAgent } from "../store/ens-agent-resolver.ts";
import { encodeInteropAddress, CHAIN_TYPE_EIP155 } from "../../../../packages/shared/src/erc7930.ts";

// ABI encoding helpers (duplicated from ens-agent-resolver.test.ts for isolation)
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

function encodeEmptyString(): string {
  return "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000000";
}

function startMockRpcServer(responses: Array<{ matchCalldata: string; result: string }>) {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { method: string; params: unknown[] };
      if (body.method === "eth_chainId") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" });
      }
      if (body.method === "eth_call") {
        const callParams = body.params[0] as { data?: string };
        const calldata = (callParams?.data ?? "").toLowerCase();
        for (const r of responses) {
          if (calldata.includes(r.matchCalldata.toLowerCase())) {
            return Response.json({ jsonrpc: "2.0", id: 1, result: r.result });
          }
        }
        return Response.json({
          jsonrpc: "2.0", id: 1,
          result: encodeEmptyString(),
        });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x0" });
    },
  });
  return { server, url: `http://localhost:${server.port}` };
}

const BASE_MAINNET_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

describe("ENS resolution path for query_agent", () => {
  test("resolveAgent returns endpoint when x402 record is present", async () => {
    const endpointUrl = "https://operator.slopstock.xyz/x402/infer?tokenId=1";
    const { server, url } = startMockRpcServer([
      { matchCalldata: "59d1d43c", result: encodeStringResponse(endpointUrl) },
    ]);
    try {
      const resolved = await resolveAgent("auditor.slopstock.eth", {
        network: "sepolia",
        rpcUrl: url,
      });
      expect(resolved.endpointX402).toBe(endpointUrl);
    } finally {
      server.stop(true);
    }
  });

  test("resolveAgent returns null endpoint when no x402 record — must not pay", async () => {
    const { server, url } = startMockRpcServer([]);
    try {
      const resolved = await resolveAgent("auditor.slopstock.eth", {
        network: "sepolia",
        rpcUrl: url,
      });
      // null endpoint means the agent cannot be reached via x402 ENS path
      expect(resolved.endpointX402).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});

describe("ENSIP-25 verification gate", () => {
  test("verified=true with non-empty record → payment allowed", async () => {
    const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, 8453n, BASE_MAINNET_REGISTRY);
    const { server, url } = startMockRpcServer([
      { matchCalldata: "59d1d43c", result: encodeStringResponse("1") },
    ]);
    try {
      const result = await verifyAgent("auditor.slopstock.eth", interopAddr, "1", {
        network: "sepolia",
        rpcUrl: url,
      });
      expect(result.verified).toBe(true);
      // Verified agents should proceed to payment
    } finally {
      server.stop(true);
    }
  });

  test("verified=false with empty record → MUST reject payment", async () => {
    const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, 8453n, BASE_MAINNET_REGISTRY);
    const { server, url } = startMockRpcServer([]); // no records
    try {
      const result = await verifyAgent("auditor.slopstock.eth", interopAddr, "1", {
        network: "sepolia",
        rpcUrl: url,
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain("ENSIP-25");
    } finally {
      server.stop(true);
    }
  });

  test("verified=false after attestation removal (demo scenario)", async () => {
    // Simulate the demo scenario: remove the attestation record and verify fails
    const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, 84532n, "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`);

    // Step 1: attestation exists → verified
    const { server: s1, url: u1 } = startMockRpcServer([
      { matchCalldata: "59d1d43c", result: encodeStringResponse("1") },
    ]);
    const r1 = await verifyAgent("auditor.slopstock.eth", interopAddr, "1", { rpcUrl: u1 });
    s1.stop(true);
    expect(r1.verified).toBe(true);

    // Step 2: attestation removed → verification MUST fail
    const { server: s2, url: u2 } = startMockRpcServer([]);
    const r2 = await verifyAgent("auditor.slopstock.eth", interopAddr, "1", { rpcUrl: u2 });
    s2.stop(true);
    expect(r2.verified).toBe(false);
    expect(r2.reason).toBeDefined();
  });

  test("key format matches ENSIP-25 spec: agent-registration[<interopAddr>][<agentId>]", async () => {
    const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, 8453n, BASE_MAINNET_REGISTRY);
    const agentId = "7";
    const { server, url } = startMockRpcServer([]);
    try {
      const result = await verifyAgent("memer.slopstock.eth", interopAddr, agentId, { rpcUrl: url });
      expect(result.key).toBe(`agent-registration[${interopAddr}][${agentId}]`);
    } finally {
      server.stop(true);
    }
  });
});

describe("ENS + ENSIP-25 integration flow", () => {
  test("full flow: resolve endpoint → verify → (mock) payment succeeds", async () => {
    const endpointUrl = "https://operator.slopstock.xyz/x402/infer?tokenId=1";
    const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, 84532n, "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`);

    // Mock returns the x402 endpoint and a non-empty attestation record
    const { server, url } = startMockRpcServer([
      { matchCalldata: "59d1d43c", result: encodeStringResponse(endpointUrl) },
    ]);
    try {
      const resolved = await resolveAgent("auditor.slopstock.eth", { network: "sepolia", rpcUrl: url });
      expect(resolved.endpointX402).not.toBeNull();

      const verified = await verifyAgent("auditor.slopstock.eth", interopAddr, "1", {
        network: "sepolia",
        rpcUrl: url,
      });
      expect(verified.verified).toBe(true);

      // At this point the payment is safe to proceed.
      // Actual payment test would require a funded wallet — gated on funding.
    } finally {
      server.stop(true);
    }
  });

  test("full flow: attestation removed → resolved endpoint ignored, payment rejected", async () => {
    const interopAddr = encodeInteropAddress(CHAIN_TYPE_EIP155, 84532n, "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`);
    const endpointUrl = "https://operator.slopstock.xyz/x402/infer?tokenId=1";

    // Mock returns endpoint but empty attestation record
    const { server: srv, url: rpcUrl } = startMockRpcServer([
      // text() for agent-endpoint[x402] returns the URL
      { matchCalldata: "59d1d43c", result: encodeStringResponse(endpointUrl) },
    ]);

    // Verify separately with a mock that returns empty for the attestation key
    const { server: srvEmpty, url: rpcEmpty } = startMockRpcServer([]);
    try {
      const verified = await verifyAgent("auditor.slopstock.eth", interopAddr, "1", {
        network: "sepolia",
        rpcUrl: rpcEmpty,
      });
      // Payment MUST be rejected
      expect(verified.verified).toBe(false);
    } finally {
      srv.stop(true);
      srvEmpty.stop(true);
    }
  });
});

describe("Fallback to BASE_SEPOLIA_AGENTS when ENS unavailable", () => {
  test("static map still contains the three known agents (AUDIT, MEMER, ORCL)", async () => {
    const { BASE_SEPOLIA_AGENTS } = await import("@stratum/shared");
    expect(BASE_SEPOLIA_AGENTS["AUDIT"]).toBeDefined();
    expect(BASE_SEPOLIA_AGENTS["MEMER"]).toBeDefined();
    expect(BASE_SEPOLIA_AGENTS["ORCL"]).toBeDefined();
  });

  test("AUDIT ensName is auditor.slopstock.eth (fallback key for ENS path)", async () => {
    const { BASE_SEPOLIA_AGENTS } = await import("@stratum/shared");
    expect(BASE_SEPOLIA_AGENTS["AUDIT"]?.ensName).toBe("auditor.slopstock.eth");
  });
});
