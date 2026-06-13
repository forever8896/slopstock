/**
 * Proves the OUTBOUND module (createAgentPayFetch) actually pays an x402 v2
 * endpoint on Base Sepolia with real USDC — the same path AUDIT uses to pay
 * Exa/CoinGecko (those are mainnet, so this stands in with our own endpoint).
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-x402-outbound.ts'
 */
import { resolveNetwork } from "@stratum/shared";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { agentWalletFor } from "../src/runtime/agent-wallet.ts";
import { createAgentPayFetch } from "../src/runtime/x402-outbound.ts";
import {
  buildAgentPaymentRequirements, createFacilitator, requirePayment, settlePayment, settleResponseHeader,
} from "../src/http/x402-v2.ts";

const ORCL_VAULT = "0x1c1fa59c0b6e631a47c7ec4717af3a0b7bfdb382";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

async function main() {
  const net = resolveNetwork({});
  const facilitator = createFacilitator(net);

  // a stand-in external x402 service: returns a "search result" after payment
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const resource = new URL(req.url).href;
      const requirements = buildAgentPaymentRequirements(net, { priceSmallest: "7000", payTo: ORCL_VAULT, resource });
      const gate = await requirePayment({
        paymentHeader: req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT"),
        resource, requirements, facilitator,
      });
      if (!gate.ok) return gate.response;
      const settle = await settlePayment({ facilitator, payload: gate.payload, requirements });
      return new Response(JSON.stringify({ results: [{ title: "Reentrancy CVE-2024-x", url: "https://example.com/cve" }] }), {
        headers: { "content-type": "application/json", "PAYMENT-RESPONSE": settleResponseHeader(settle) },
      });
    },
  });

  const account = agentWalletFor(process.env["OPERATOR_PRIVATE_KEY"] as `0x${string}`, 1n);
  const payFetch = createAgentPayFetch(account); // <-- the OUTBOUND module under test
  const pub = createPublicClient({ chain: baseSepolia, transport: http(net.base.rpcUrl) });
  const before = (await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [ORCL_VAULT] })) as bigint;

  console.log(`[outbound] AUDIT ${account.address} paying external x402 service…`);
  const res = await payFetch(`http://localhost:${server.port}/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "reentrancy" }) });
  const body = await res.json();
  console.log(`[outbound] status=${res.status} body=${JSON.stringify(body)}`);

  let after = before;
  for (let i = 0; i < 12 && after <= before; i++) { await new Promise((r) => setTimeout(r, 2000)); after = (await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [ORCL_VAULT] })) as bigint; }
  console.log(`[outbound] vault delta = ${formatUnits(after - before, 6)} USDC`);
  console.log(res.status === 200 && after > before ? "✅ OUTBOUND module paid a real x402 service (testnet)" : "⚠️ check above");
  server.stop(true);
}
main().catch((e) => { console.error("failed:", e); process.exit(1); });
