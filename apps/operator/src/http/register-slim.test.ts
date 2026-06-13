/**
 * Hermetic unit test for the slimmed /agents/register contract.
 *
 * No network, no secrets, no disk writes (initRegistry is never called so
 * dynamic-registry.flush() is a no-op). Finance deploy is skipped because
 * startFinanceDeployAsync gates on DEPLOYER_PRIVATE_KEY (absent here).
 */

import { afterEach, expect, test } from "bun:test";
import { clearDynamicRegistryForTest } from "../store/dynamic-registry.ts";

// Satisfy loadConfig()'s required-field validation before importing anything
// that might call it. These are hex-shaped but otherwise fake.
process.env["OPERATOR_PRIVATE_KEY"] = "0x" + "a".repeat(64);
process.env["AGENT_NFT_ADDRESS"] = "0x" + "b".repeat(40);
process.env["AGENT_REGISTRY_ADDRESS"] = "0x" + "c".repeat(40);
process.env["AGENT_VAULT_ADDRESS"] = "0x" + "d".repeat(40);

import { handleRegisterAgent } from "./server.ts";
import { loadConfig } from "../config.ts";

function req(body: unknown) {
  return new Request("http://x/agents/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  clearDynamicRegistryForTest();
});

test("slim register forces hermes + 0g-compute and rejects missing fields", async () => {
  const deps = { config: loadConfig() } as never;

  // Missing required fields → 400
  const bad = await handleRegisterAgent(req({ ticker: "X" }), deps);
  expect(bad.status).toBe(400);

  // Valid minimal payload
  const ok = await handleRegisterAgent(
    req({
      tokenId: "900002",
      ticker: "HAIKU",
      name: "Haiku",
      description: "d",
      systemPrompt: "You are a haiku agent.",
      perCallSmallest: "100000",
      creator: "0x0000000000000000000000000000000000000001",
      txHash: "0x" + "0".repeat(64),
    }),
    deps,
  );
  expect(ok.status).toBeLessThan(300);

  const body = await ok.json();
  expect(body.agent.runtime).toBe("hermes");
  expect(body.agent.backend).toBe("0g-compute");
});

test("slim register accepts perCallUsd as alternate to perCallSmallest", async () => {
  const deps = { config: loadConfig() } as never;

  const ok = await handleRegisterAgent(
    req({
      tokenId: "900003",
      ticker: "USD",
      description: "usd test",
      systemPrompt: "You are a USD agent.",
      perCallUsd: "0.50",
      creator: "0x0000000000000000000000000000000000000001",
      txHash: "0x" + "0".repeat(64),
    }),
    deps,
  );
  expect(ok.status).toBeLessThan(300);

  const body = await ok.json();
  // $0.50 × 1e6 = 500000
  expect(body.agent.perCallSmallest).toBe("500000");
  expect(body.agent.runtime).toBe("hermes");
  expect(body.agent.backend).toBe("0g-compute");
});

test("slim register rejects when neither perCallSmallest nor perCallUsd is provided", async () => {
  const deps = { config: loadConfig() } as never;

  const bad = await handleRegisterAgent(
    req({
      tokenId: "900004",
      ticker: "MISS",
      description: "missing price",
      systemPrompt: "You are an agent.",
      creator: "0x0000000000000000000000000000000000000001",
      txHash: "0x" + "0".repeat(64),
    }),
    deps,
  );
  expect(bad.status).toBe(400);
  const body = await bad.json();
  expect(body.error).toContain("perCallSmallest");
});

test("slim register does not set templateId / runtimeTier / manifestShadow / bundleManifestCid", async () => {
  const deps = { config: loadConfig() } as never;

  const ok = await handleRegisterAgent(
    req({
      tokenId: "900005",
      ticker: "SLIM",
      description: "no legacy fields",
      systemPrompt: "You are slim.",
      perCallSmallest: "200000",
      creator: "0x0000000000000000000000000000000000000001",
      txHash: "0x" + "0".repeat(64),
    }),
    deps,
  );
  expect(ok.status).toBeLessThan(300);

  const body = await ok.json();
  expect(body.agent.templateId).toBeUndefined();
  expect(body.agent.runtimeTier).toBeUndefined();
  expect(body.agent.manifestShadow).toBeUndefined();
  expect(body.agent.bundleManifestCid).toBeUndefined();
});
