/**
 * Print the deterministic agent wallets for tokenIds 1, 2, 3.
 * The operator derives them from OPERATOR_PRIVATE_KEY + tokenId so they're
 * reproducible. Use this output to fund the wallets that need to pay other
 * agents (today: AUDIT pays ORCL, so AUDIT's wallet needs USDC + ETH).
 *
 * Run: bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/print-agent-wallets.ts'
 */

import { agentWalletFor } from "../src/runtime/agent-wallet.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
console.log("operator key:", `${config.OPERATOR_PRIVATE_KEY.slice(0, 10)}…`);
for (const id of [1n, 2n, 3n]) {
  const w = agentWalletFor(config.OPERATOR_PRIVATE_KEY as `0x${string}`, id);
  console.log(`tokenId=${id}  agent wallet:  ${w.address}`);
}
