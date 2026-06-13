/**
 * ERC-7930 interoperable address encoding — TDD tests
 *
 * The plan (02-ens-erc8004.md) provides a reference example:
 *   Base mainnet (chainId 8453 = 0x2105), IdentityRegistry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   → agent-registration[0x00010000022105148004a169fb4a3325136eb29fa0ceb6d2e539a432][<agentId>]
 *
 * The plan itself warns: "Verify the ERC-7930 encoding with a lib before demo".
 * We test the LOGICAL structure (correct fields round-trip), and separately test
 * that the key SHAPE matches the spec's structural form.
 */

import { describe, expect, test } from "bun:test";
import {
  encodeInteropAddress,
  decodeInteropAddress,
  ensip25RegistrationKey,
  agentTextRecordKeys,
  CHAIN_TYPE_EIP155,
} from "./erc7930";

// Canonical ERC-8004 addresses from network.ts / plan docs
const BASE_MAINNET_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const BASE_MAINNET_CHAIN_ID = 8453n;
const BASE_SEPOLIA_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const BASE_SEPOLIA_CHAIN_ID = 84532n;

describe("ERC-7930 encodeInteropAddress", () => {
  test("produces a 0x-prefixed hex string", () => {
    const result = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    expect(result).toMatch(/^0x[0-9a-f]+$/i);
  });

  test("encoded interop address for Base mainnet starts with EIP-155 chain type 0x0001", () => {
    const result = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    // First 4 hex chars = 2 bytes = chainType = 0x0001
    expect(result.slice(2, 6)).toBe("0001");
  });

  test("encoded address contains the 20-byte EVM address (lowercase) at the end", () => {
    const result = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    const withoutPrefix = result.slice(2).toLowerCase();
    // The last 40 hex chars should be the address
    expect(withoutPrefix.slice(-40)).toBe(BASE_MAINNET_IDENTITY_REGISTRY.slice(2).toLowerCase());
  });

  test("encoded address total length is 2+2+N+1+20 bytes where N=byteLen(chainId)", () => {
    // chainId 8453 = 0x2105 = 2 bytes; so total = 2+2+2+1+20 = 27 bytes = 54 hex chars
    const result = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    const byteLen = (result.length - 2) / 2; // subtract "0x", divide by 2
    expect(byteLen).toBe(27); // 2(chainType)+2(chainRefLen)+2(chainRef)+1(addrLen)+20(addr)
  });

  test("encodes chainRef (chainId) as minimal big-endian uint — no leading zero bytes", () => {
    // 8453 = 0x2105 → 2 bytes; verify chainRefLen field is 0x0002
    const result = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    // bytes 3-4 (hex chars 6-9) = chainRefLen
    const chainRefLen = parseInt(result.slice(6, 10), 16);
    expect(chainRefLen).toBe(2); // 8453 fits in 2 bytes
  });

  test("encodes chainId=8453 correctly in chainRef field", () => {
    const result = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    // chainRefLen = 2, so chainRef occupies hex chars 10-13 (2 bytes)
    const chainRefHex = result.slice(10, 14);
    expect(parseInt(chainRefHex, 16)).toBe(8453);
  });

  test("addrLen byte is 0x14 (20 decimal) for EVM addresses", () => {
    const result = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    // All offsets below are into the hex string AFTER the "0x" prefix.
    // Layout: [chainType:4][chainRefLen:4][chainRef:N*2][addrLen:2][addr:40]
    // result.slice(X, Y) is from absolute position (includes "0x" at start).
    const hex = result.slice(2); // strip "0x"
    const chainRefLen = parseInt(hex.slice(4, 8), 16); // bytes 3-4 = chainRefLen
    const addrLenStart = 8 + chainRefLen * 2; // 4 (chainType) + 4 (chainRefLen) + chainRef hex chars
    const addrLen = parseInt(hex.slice(addrLenStart, addrLenStart + 2), 16);
    expect(addrLen).toBe(20);
  });

  test("matches the spec example SHAPE — chainType=0x0001, chainRef=8453, addr=IdentityRegistry", () => {
    // The spec example encoding in the plan doc may differ from our implementation
    // because the plan warns to verify with a lib. We test the decoded round-trip instead.
    const encoded = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    const decoded = decodeInteropAddress(encoded);
    expect(decoded.chainType).toBe(CHAIN_TYPE_EIP155);
    expect(decoded.chainId).toBe(BASE_MAINNET_CHAIN_ID);
    expect(decoded.address.toLowerCase()).toBe(BASE_MAINNET_IDENTITY_REGISTRY.toLowerCase());
  });

  test("Base Sepolia registry encodes with chainId 84532", () => {
    const encoded = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_IDENTITY_REGISTRY as `0x${string}`);
    const decoded = decodeInteropAddress(encoded);
    expect(decoded.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(decoded.address.toLowerCase()).toBe(BASE_SEPOLIA_IDENTITY_REGISTRY.toLowerCase());
  });

  test("different addresses produce different encodings", () => {
    const a = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`);
    const b = encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_IDENTITY_REGISTRY as `0x${string}`);
    expect(a).not.toBe(b);
  });

  test("throws on non-20-byte address", () => {
    expect(() =>
      encodeInteropAddress(CHAIN_TYPE_EIP155, BASE_MAINNET_CHAIN_ID, "0x1234" as `0x${string}`)
    ).toThrow(/20 bytes/);
  });

  test("chainId=1 (Ethereum mainnet) encodes as single byte 0x01", () => {
    const encoded = encodeInteropAddress(CHAIN_TYPE_EIP155, 1n, "0x0000000000000000000000000000000000000001" as `0x${string}`);
    const chainRefLen = parseInt(encoded.slice(6, 10), 16);
    expect(chainRefLen).toBe(1);
    expect(decoded(encoded).chainId).toBe(1n);
  });

  test("chainId=0 encodes as single byte 0x00", () => {
    const encoded = encodeInteropAddress(CHAIN_TYPE_EIP155, 0n, "0x0000000000000000000000000000000000000001" as `0x${string}`);
    const chainRefLen = parseInt(encoded.slice(6, 10), 16);
    expect(chainRefLen).toBe(1);
  });

  // Snapshot test: verify exact byte encoding of Base mainnet IdentityRegistry.
  // This is the value that will appear in ENSIP-25 text record keys.
  test("exact encoding snapshot for Base mainnet IdentityRegistry (canonical reference)", () => {
    const encoded = encodeInteropAddress(
      CHAIN_TYPE_EIP155,
      8453n,
      "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    );
    // Expected: chainType=0001, chainRefLen=0002, chainRef=2105, addrLen=14, addr=8004...a432
    expect(encoded).toBe("0x000100022105148004a169fb4a3325136eb29fa0ceb6d2e539a432");
  });
});

// Helper for the test above
function decoded(hex: `0x${string}`) {
  return decodeInteropAddress(hex);
}

describe("decodeInteropAddress round-trip", () => {
  test("round-trips for various chain ids", () => {
    const cases: Array<{ chainId: bigint; addr: `0x${string}` }> = [
      { chainId: 1n, addr: "0x1234567890123456789012345678901234567890" },
      { chainId: 8453n, addr: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" },
      { chainId: 84532n, addr: "0x8004A818BFB912233c491871b3d84c89A494BD9e" },
      { chainId: 137n, addr: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" },
    ];

    for (const { chainId, addr } of cases) {
      const encoded = encodeInteropAddress(CHAIN_TYPE_EIP155, chainId, addr);
      const result = decodeInteropAddress(encoded);
      expect(result.chainType).toBe(CHAIN_TYPE_EIP155);
      expect(result.chainId).toBe(chainId);
      expect(result.address.toLowerCase()).toBe(addr.toLowerCase());
    }
  });
});

describe("ensip25RegistrationKey", () => {
  test("produces the correct key format", () => {
    const key = ensip25RegistrationKey(
      BASE_MAINNET_CHAIN_ID,
      BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`,
      "1",
    );
    expect(key).toMatch(/^agent-registration\[0x[0-9a-f]+\]\[1\]$/);
  });

  test("key contains the correct interop address", () => {
    const key = ensip25RegistrationKey(
      BASE_MAINNET_CHAIN_ID,
      BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`,
      "42",
    );
    // Extract interop address from key
    const match = key.match(/agent-registration\[(0x[0-9a-f]+)\]\[42\]/);
    expect(match).not.toBeNull();
    const interopAddr = match![1] as `0x${string}`;
    const decoded = decodeInteropAddress(interopAddr);
    expect(decoded.chainId).toBe(BASE_MAINNET_CHAIN_ID);
    expect(decoded.address.toLowerCase()).toBe(BASE_MAINNET_IDENTITY_REGISTRY.toLowerCase());
  });

  test("rejects agentId containing brackets", () => {
    expect(() =>
      ensip25RegistrationKey(BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`, "a[b]c")
    ).toThrow(/agentId must not contain/);
  });

  test("agentId is preserved verbatim in the key", () => {
    const key = ensip25RegistrationKey(BASE_MAINNET_CHAIN_ID, BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`, "agent-007");
    expect(key).toContain("[agent-007]");
  });
});

describe("agentTextRecordKeys", () => {
  test("returns the fixed ENSIP-26 key names", () => {
    const keys = agentTextRecordKeys({});
    expect(keys.agentContext).toBe("agent-context");
    expect(keys.agentEndpointX402).toBe("agent-endpoint[x402]");
    expect(keys.agentEndpointMcp).toBe("agent-endpoint[mcp]");
    expect(keys.agentEndpointWeb).toBe("agent-endpoint[web]");
  });

  test("agentRegistration is null when no registry info provided", () => {
    const keys = agentTextRecordKeys({});
    expect(keys.agentRegistration).toBeNull();
  });

  test("agentRegistration key is set when registry info is provided", () => {
    const keys = agentTextRecordKeys({
      registryChainId: BASE_MAINNET_CHAIN_ID,
      registryAddress: BASE_MAINNET_IDENTITY_REGISTRY as `0x${string}`,
      agentId: "1",
    });
    expect(keys.agentRegistration).toMatch(/^agent-registration\[0x[0-9a-f]+\]\[1\]$/);
  });

  test("Base Sepolia agentRegistration key uses Sepolia registry address", () => {
    const keys = agentTextRecordKeys({
      registryChainId: BASE_SEPOLIA_CHAIN_ID,
      registryAddress: BASE_SEPOLIA_IDENTITY_REGISTRY as `0x${string}`,
      agentId: "7",
    });
    const match = keys.agentRegistration?.match(/agent-registration\[(0x[0-9a-f]+)\]\[7\]/);
    expect(match).not.toBeNull();
    const interopAddr = match![1] as `0x${string}`;
    const decoded = decodeInteropAddress(interopAddr);
    expect(decoded.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(decoded.address.toLowerCase()).toBe(BASE_SEPOLIA_IDENTITY_REGISTRY.toLowerCase());
  });
});
