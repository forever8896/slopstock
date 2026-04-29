/**
 * Smoke test for the Hermes agent runtime, bypassing x402 for the
 * caller — but exercising real x402 if the agent fires query_agent.
 *
 * Run with the operator's env loaded (and a separate operator process
 * running on :8402 for query_agent to reach):
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-hermes.ts'
 */

import { buildClients } from "../src/chain/clients.ts";
import { loadConfig } from "../src/config.ts";
import { HermesAgentRuntime } from "../src/runtime/hermes.ts";
import { OpenAICompatBackend, ZGComputeBackend, getZGBroker } from "../src/runtime/llm-backend.ts";

const SAMPLE_VAULT_USING_UNISWAP = `
pragma solidity ^0.8.0;

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
}

contract LendingPool {
    IUniswapV2Pair public immutable pair;
    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;

    constructor(address _pair) { pair = IUniswapV2Pair(_pair); }

    function deposit() external payable {
        collateral[msg.sender] += msg.value;
    }

    function priceOfEth() public view returns (uint256) {
        // BUG: spot price from Uniswap v2 — flash-loan manipulable
        (uint112 r0, uint112 r1,) = pair.getReserves();
        return uint256(r1) * 1e18 / uint256(r0);
    }

    function borrow(uint256 amount) external {
        uint256 maxBorrow = collateral[msg.sender] * priceOfEth() / 1e18 / 2;
        require(debt[msg.sender] + amount <= maxBorrow, "undercollateralized");
        debt[msg.sender] += amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }
}
`;

async function main() {
  const config = { ...loadConfig(), AGENT_RUNTIME: "hermes" as const };
  const clients = buildClients(config);

  // Pick backend per env (fallback to OpenAI-compat / Ollama).
  const backendKind = process.env["SMOKE_BACKEND"] ?? config.COMPUTE_BACKEND;
  const backend =
    backendKind === "0g-compute"
      ? new ZGComputeBackend({
          broker: await getZGBroker(config),
          providerAddress: config.ZG_COMPUTE_PROVIDER_ADDRESS as `0x${string}`,
        })
      : new OpenAICompatBackend({
          baseUrl: config.COMPUTE_BASE_URL,
          apiKey: config.COMPUTE_API_KEY,
          model: config.COMPUTE_MODEL,
        });
  console.log(`[smoke] backend: ${backend.kind} (${backend.description})`);

  const runtime = new HermesAgentRuntime(config, backend);
  runtime.attachOperatorContext(clients);

  const tokenId = 1n;
  console.log(`[smoke] loading runtime for tokenId=${tokenId} (AUDIT)`);
  await runtime.load({ tokenId });

  console.log(`[smoke] running task (input: a flash-loan-vulnerable lending pool)`);
  const t0 = Date.now();
  const result = await runtime.runTask({
    tokenId,
    subscriber: "0x1234567890123456789012345678901234567890",
    input: SAMPLE_VAULT_USING_UNISWAP,
    paymentReceiptId: "rcpt-smoke",
  });
  const elapsed = Date.now() - t0;

  console.log(`[smoke] elapsed: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`[smoke] model: ${result.model}`);
  console.log(`[smoke] bundleHashBefore: ${result.bundleHashBefore}`);
  console.log(`[smoke] bundleHashAfter:  ${result.bundleHashAfter}`);
  console.log(`[smoke] skillsLoaded:  ${JSON.stringify(result.skillsLoaded)}`);
  console.log(`[smoke] skillsCreated: ${JSON.stringify(result.skillsCreated)}`);
  console.log(`[smoke] transcript (${result.transcript.length} steps):`);
  for (const step of result.transcript) {
    console.log(`  ${step.kind.padEnd(13)} ${describeStep(step)}`);
  }
  console.log(`\n[smoke] === final output ===`);
  console.log(result.output);
}

function describeStep(s: import("@stratum/shared").AgentStep): string {
  switch (s.kind) {
    case "llm": return `${s.model} (${s.promptTokens ?? "?"} prompt / ${s.completionTokens ?? "?"} completion)`;
    case "tool": return `${s.tool} → ${s.resultSummary}`;
    case "skill_load": return s.skill;
    case "skill_create": return s.skill;
    case "memory_read": return `recall("${s.query}") → ${s.resultCount}`;
    case "memory_write": return s.key;
  }
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(1);
});
