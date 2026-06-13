/**
 * Hermetic unit test: dynamic-registry agents always route to HermesAgentRuntime
 * on the 0g-compute backend, regardless of any per-agent backend/runtimeTier
 * field they may carry.
 *
 * No live network, 0G broker, or wallet is required — getZGBroker is stubbed
 * at the module level before the router is imported.
 */

import { mock, beforeEach, afterEach, test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── 1. Stub out the 0G broker BEFORE any module that imports llm-backend loads ──
//  Bun's mock.module replaces the module for this test file's require graph.
const fakeBroker = { fake: true };
const fakeZGBackend = { kind: "0g-compute-backend" as const };

mock.module("../runtime/llm-backend.ts", () => ({
  getZGBroker: async () => fakeBroker,
  ZGComputeBackend: class {
    readonly kind = "0g-compute-backend";
    constructor() {}
  },
  OpenAICompatBackend: class {
    readonly kind = "openai-compat-backend";
    constructor() {}
  },
}));

// ── 2. Now import the modules under test ──
import { buildRuntimeRouter } from "./index.ts";
import {
  registerDynamicAgent,
  clearDynamicRegistryForTest,
} from "../store/dynamic-registry.ts";
import type { OperatorConfig } from "../config.ts";

// ── 3. Minimal OperatorConfig — only the fields the router actually reads ──
function makeConfig(dataDir: string): OperatorConfig {
  return {
    ZG_RPC_URL: "https://evmrpc-testnet.0g.ai",
    ZG_COMPUTE_RPC_URL: "https://evmrpc.0g.ai",
    BASE_RPC_URL: "https://base-sepolia-rpc.publicnode.com",
    SEPOLIA_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
    AGENT_RUNTIME: "openai-compat",
    RUNTIME_BY_TOKEN_ID: {},
    AGENTS_DATA_DIR: dataDir,
    COMPUTE_BACKEND: "openai-compat",
    BACKEND_BY_TOKEN_ID: {},
    COMPUTE_BASE_URL: "http://127.0.0.1:11434/v1",
    COMPUTE_API_KEY: undefined,
    COMPUTE_MODEL: "qwen2.5-coder:7b",
    ZG_COMPUTE_PROVIDER_ADDRESS: "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08",
    X402_USDC_ADDRESS: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    X402_MIN_CONFIRMATIONS: 0,
    HTTP_PORT: 8402,
    MCP_PORT: 9050,
    AXL_BRIDGE_URL: "http://127.0.0.1:9001",
    OPERATOR_PRIVATE_KEY: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    DEPLOYER_PRIVATE_KEY: undefined,
    AGENT_NFT_ADDRESS: "0x0000000000000000000000000000000000000001",
    AGENT_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000002",
    AGENT_VAULT_ADDRESS: "0x0000000000000000000000000000000000000003",
    RECEIPTS_DB_PATH: "./data/receipts.db",
  };
}

let dataDir: string;

beforeEach(async () => {
  clearDynamicRegistryForTest();
  dataDir = await mkdtemp(join(tmpdir(), "router-dyn-"));
});

afterEach(() => {
  clearDynamicRegistryForTest();
});

test("dynamic-registry agent routes to HermesAgentRuntime (kind === 'hermes')", async () => {
  const TOKEN_ID = "42";

  await registerDynamicAgent({
    tokenId: TOKEN_ID,
    ticker: "TEST",
    description: "A test agent",
    systemPrompt: "You are a test agent.",
    model: "some-model",
    perCallSmallest: "500000",
    perCallHuman: "0.50",
    runtime: "hermes",
    backend: "openai-compat", // intentionally old value — must be IGNORED by new code
    creator: "0x0000000000000000000000000000000000000099",
    txHash: "0xdeadbeef",
    createdAt: Date.now(),
  });

  const router = buildRuntimeRouter(makeConfig(dataDir));
  const rt = await router.forToken(BigInt(TOKEN_ID));

  expect(rt.kind).toBe("hermes");
});

test("non-dynamic token is NOT routed through the dynamic branch", async () => {
  // No dynamic registration — token 999 should go down the static/legacy path.
  // That path defaults to openai-compat when AGENT_RUNTIME is openai-compat.
  const router = buildRuntimeRouter(makeConfig(dataDir));
  const rt = await router.forToken(999n);

  // Static branch: AGENT_RUNTIME defaults to openai-compat
  expect(rt.kind).toBe("openai-compat");
});
