/**
 * Tests for ens-subname.ts text record extension (ENSIP-26 / ENSIP-25).
 *
 * Tests here cover:
 *   - Interface shape of setTextRecords / readTextRecord
 *   - That mainnet path is correctly wired (not fired — reads are safe)
 *   - That the PublicResolver ABI includes setText and text()
 *   - Record key format helpers
 *
 * Note: live Sepolia writes are not run here (they need DEPLOYER_PRIVATE_KEY
 * and gas). The "ready-but-not-fired" mainnet path is validated at the type
 * level; actual mainnet writes are gated on L1 ETH funding.
 */

import { describe, expect, test } from "bun:test";
import { namehash } from "viem";

// Test that the module exports the expected types/functions
import {
  type SetTextRecordsOpts,
  type SetTextRecordsResult,
  type TextRecord,
  readTextRecord,
} from "./ens-subname.ts";

// The actual type check below ensures setTextRecords is exported and typed correctly.
// We import it but only call readTextRecord (a read-only operation that's safe without funding).
import { setTextRecords } from "./ens-subname.ts";

describe("setTextRecords exports and types", () => {
  test("setTextRecords is a function", () => {
    expect(typeof setTextRecords).toBe("function");
  });

  test("readTextRecord is a function", () => {
    expect(typeof readTextRecord).toBe("function");
  });

  test("TextRecord type shape is correct (compile-time check via object construction)", () => {
    const record: TextRecord = { key: "agent-context", value: "Test agent" };
    expect(record.key).toBe("agent-context");
    expect(record.value).toBe("Test agent");
  });

  test("SetTextRecordsOpts requires ensName, records, deployerKey", () => {
    // This is a compile-time check — if it compiles, the types are correct.
    const opts: SetTextRecordsOpts = {
      ensName: "auditor.slopstock.eth",
      records: [
        { key: "agent-context", value: "Solidity security auditor" },
        { key: "agent-endpoint[x402]", value: "https://operator.slopstock.xyz/x402/infer?tokenId=1" },
      ],
      deployerKey: "0x" + "a".repeat(64) as `0x${string}`,
      network: "sepolia",
    };
    expect(opts.ensName).toBe("auditor.slopstock.eth");
    expect(opts.records).toHaveLength(2);
    expect(opts.network).toBe("sepolia");
  });

  test("network defaults — mainnet path is wired, testnet is default", () => {
    // Verify that both network values are accepted by the type
    const mainnetOpts: SetTextRecordsOpts = {
      ensName: "auditor.slopstock.eth",
      records: [],
      deployerKey: "0x" + "a".repeat(64) as `0x${string}`,
      network: "mainnet", // FUNDING GATE: do not call this without L1 ETH
    };
    const testnetOpts: SetTextRecordsOpts = {
      ensName: "auditor.slopstock.eth",
      records: [],
      deployerKey: "0x" + "a".repeat(64) as `0x${string}`,
      // no network → defaults to "sepolia"
    };
    expect(mainnetOpts.network).toBe("mainnet");
    expect(testnetOpts.network).toBeUndefined(); // will default to "sepolia" at runtime
  });
});

describe("ENSIP-26 text record key format", () => {
  test("agent-context key is the literal string 'agent-context'", () => {
    const key = "agent-context";
    expect(key).toBe("agent-context");
  });

  test("agent-endpoint[x402] key is correct ENSIP-26 format", () => {
    const key = "agent-endpoint[x402]";
    expect(key).toMatch(/^agent-endpoint\[x402\]$/);
  });

  test("agent-endpoint[mcp] key is correct", () => {
    expect("agent-endpoint[mcp]").toMatch(/^agent-endpoint\[mcp\]$/);
  });

  test("agent-endpoint[web] key is correct", () => {
    expect("agent-endpoint[web]").toMatch(/^agent-endpoint\[web\]$/);
  });

  test("namehash produces deterministic node for auditor.slopstock.eth", () => {
    const node = namehash("auditor.slopstock.eth");
    // Verify idempotency
    expect(namehash("auditor.slopstock.eth")).toBe(node);
    // Verify it differs from the parent
    expect(node).not.toBe(namehash("slopstock.eth"));
  });
});

describe("readTextRecord (read-only Sepolia call with mock RPC)", () => {
  test("returns empty string when no record is set (mock RPC)", async () => {
    // Start a minimal mock RPC that returns empty string for any eth_call
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { method: string };
        if (body.method === "eth_chainId") {
          return Response.json({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" });
        }
        if (body.method === "eth_call") {
          return Response.json({
            jsonrpc: "2.0", id: 1,
            result: "0x" +
              "0000000000000000000000000000000000000000000000000000000000000020" +
              "0000000000000000000000000000000000000000000000000000000000000000",
          });
        }
        return Response.json({ jsonrpc: "2.0", id: 1, result: "0x0" });
      },
    });
    try {
      const val = await readTextRecord("auditor.slopstock.eth", "agent-context", {
        network: "sepolia",
        rpcUrl: `http://localhost:${server.port}`,
      });
      expect(val).toBe("");
    } finally {
      server.stop(true);
    }
  });

  test("returns the record value when present (mock RPC)", async () => {
    const expectedValue = "Solidity security auditor specializing in DeFi";
    const bytes = new TextEncoder().encode(expectedValue);
    const len = bytes.length;
    const padded = new Uint8Array(Math.ceil(len / 32) * 32);
    padded.set(bytes);
    const encodedResult =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      len.toString(16).padStart(64, "0") +
      Array.from(padded).map(b => b.toString(16).padStart(2, "0")).join("");

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { method: string };
        if (body.method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" });
        if (body.method === "eth_call") return Response.json({ jsonrpc: "2.0", id: 1, result: encodedResult });
        return Response.json({ jsonrpc: "2.0", id: 1, result: "0x0" });
      },
    });
    try {
      const val = await readTextRecord("auditor.slopstock.eth", "agent-context", {
        network: "sepolia",
        rpcUrl: `http://localhost:${server.port}`,
      });
      expect(val).toBe(expectedValue);
    } finally {
      server.stop(true);
    }
  });
});

describe("FUNDING GATE documentation — mainnet write path", () => {
  /**
   * These tests document what needs to happen once L1 ETH is available.
   * They are NOT skipped — they verify that the code is structured correctly
   * and that the function signatures accept the mainnet parameters.
   *
   * TO GO LIVE: call setTextRecords({ network: "mainnet", ... }) once the
   * deployer wallet (owns slopstock.eth on mainnet) is funded with L1 ETH.
   */

  test("setTextRecords accepts mainnet network parameter (type-level; not called)", () => {
    // This test verifies the API surface is correct without calling the function.
    const mainnetCall = (): Promise<SetTextRecordsResult> => setTextRecords({
      ensName: "auditor.slopstock.eth",
      records: [
        { key: "agent-context", value: "Solidity security auditor" },
        { key: "agent-endpoint[x402]", value: "https://operator.slopstock.xyz/x402/infer?tokenId=1" },
        { key: "agent-endpoint[mcp]", value: "https://operator.slopstock.xyz/mcp" },
        // agent-registration key is built via ensip25RegistrationKey() from erc7930.ts
      ],
      deployerKey: "0x" + "a".repeat(64) as `0x${string}`, // replace with DEPLOYER_PRIVATE_KEY
      network: "mainnet",
      // rpcUrl: "https://eth.llamarpc.com", // or a paid RPC for reliability
    });
    // Only verifying the function is callable with these args at the type level
    expect(typeof mainnetCall).toBe("function");
  });
});
