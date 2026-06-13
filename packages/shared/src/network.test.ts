import { describe, expect, test } from "bun:test";

import { assertNetworkConfigured, resolveNetwork } from "./network";

describe("resolveNetwork", () => {
  test("defaults to testnet when NETWORK is unset", () => {
    const net = resolveNetwork({});
    expect(net.name).toBe("testnet");
    expect(net.base.chainId).toBe(84532);
  });

  test("selects mainnet chain ids when NETWORK=mainnet", () => {
    const net = resolveNetwork({ NETWORK: "mainnet" });
    expect(net.name).toBe("mainnet");
    expect(net.base.chainId).toBe(8453);
    expect(net.zg.chainId).toBe(16661);
    expect(net.ens.chainId).toBe(1);
  });

  test("mainnet Base USDC is the canonical Circle USDC", () => {
    const net = resolveNetwork({ NETWORK: "mainnet" });
    expect(net.base.usdc.toLowerCase()).toBe(
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    );
  });

  test("mainnet uses the CDP facilitator; testnet uses the keyless one", () => {
    expect(resolveNetwork({ NETWORK: "mainnet" }).x402.facilitatorUrl).toBe(
      "https://x402.coinbase.com",
    );
    expect(resolveNetwork({ NETWORK: "testnet" }).x402.facilitatorUrl).toBe(
      "https://x402.org/facilitator",
    );
  });

  test("env RPC overrides win over the baked-in default", () => {
    const net = resolveNetwork({ NETWORK: "mainnet", BASE_RPC_URL: "https://my.rpc" });
    expect(net.base.rpcUrl).toBe("https://my.rpc");
  });

  test("rejects an unknown NETWORK value loudly", () => {
    expect(() => resolveNetwork({ NETWORK: "staging" })).toThrow(/unknown NETWORK/i);
  });
});

describe("network agent bundle", () => {
  test("testnet carries the deployed Base Sepolia agent bundle", () => {
    const net = resolveNetwork({});
    const audit = net.agents.AUDIT;
    expect(audit).toBeDefined();
    expect(audit?.ensName).toBe("auditor.slopstock.eth");
    expect(audit?.tokenId).toBe(1n);
  });

  test("mainnet agent bundle is empty until agents are deployed", () => {
    const net = resolveNetwork({ NETWORK: "mainnet" });
    expect(Object.keys(net.agents)).toHaveLength(0);
  });
});

describe("ERC-8004 canonical registries (verified on-chain to have bytecode)", () => {
  test("mainnet registries match the canonical Base mainnet deployment", () => {
    const net = resolveNetwork({ NETWORK: "mainnet" });
    expect(net.erc8004.identityRegistry).toBe("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
    expect(net.erc8004.reputationRegistry).toBe("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");
  });

  test("testnet registries match the canonical Base Sepolia deployment", () => {
    const net = resolveNetwork({});
    expect(net.erc8004.identityRegistry).toBe("0x8004A818BFB912233c491871b3d84c89A494BD9e");
    expect(net.erc8004.reputationRegistry).toBe("0x8004B663056A597Dffe9eCcC1965A193B7388713");
  });
});

describe("assertNetworkConfigured", () => {
  test("passes for a configured testnet", () => {
    expect(() => assertNetworkConfigured(resolveNetwork({}))).not.toThrow();
  });

  test("throws on mainnet with no agent bundle (can't half-configure on stage)", () => {
    expect(() => assertNetworkConfigured(resolveNetwork({ NETWORK: "mainnet" }))).toThrow(
      /not configured/i,
    );
  });
});
