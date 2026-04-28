/**
 * Smoke test for the Hermes agent runtime, bypassing x402.
 *
 * Run with the operator's env loaded:
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-hermes.ts'
 *
 * Prints the transcript so we can see whether the agent is actually using
 * tools, loading skills, generating new ones, and whether the bundle hash
 * changes.
 */

import { loadConfig } from "../src/config.ts";
import { HermesAgentRuntime } from "../src/runtime/hermes.ts";

const SAMPLE_VAULT_WITH_REENTRANCY = `
pragma solidity ^0.8.0;

contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "no balance");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] = 0;
    }

    function ownerWithdrawAll() external {
        // BUG: no access control
        payable(msg.sender).transfer(address(this).balance);
    }
}
`;

async function main() {
  const config = { ...loadConfig(), AGENT_RUNTIME: "hermes" as const };
  const runtime = new HermesAgentRuntime(config);

  const tokenId = 1n;
  console.log(`[smoke] loading runtime for tokenId=${tokenId}`);
  await runtime.load({ tokenId });

  const before = await runtime.bundleHash(tokenId);
  console.log(`[smoke] bundleHash before: ${before}`);

  console.log(`[smoke] running task…`);
  const t0 = Date.now();
  const result = await runtime.runTask({
    tokenId,
    subscriber: "0x1234567890123456789012345678901234567890",
    input: SAMPLE_VAULT_WITH_REENTRANCY,
    paymentReceiptId: "rcpt-smoke",
  });
  const elapsed = Date.now() - t0;

  console.log(`[smoke] elapsed: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`[smoke] model: ${result.model}`);
  console.log(`[smoke] bundleHashBefore: ${result.bundleHashBefore}`);
  console.log(`[smoke] bundleHashAfter:  ${result.bundleHashAfter}`);
  console.log(`[smoke] stateDeltaHash:   ${result.stateDeltaHash}`);
  console.log(`[smoke] skillsLoaded: ${JSON.stringify(result.skillsLoaded)}`);
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
    case "tool": return `${s.tool} args=${s.argsHash.slice(0, 14)}… → ${s.resultSummary}`;
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
