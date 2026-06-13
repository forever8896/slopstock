/**
 * REAL end-to-end x402 v2 on Base Sepolia. No mock, no stub.
 *
 * Stands up a local server using our v2 primitives (build402 / requirePayment /
 * settlePayment) wired to the real keyless facilitator, then pays it from
 * AUDIT's funded wallet via @x402/fetch. Asserts USDC actually moves on-chain
 * to ORCL's vault.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-x402-v2-sepolia.ts'
 */

import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

import { resolveNetwork } from "@stratum/shared";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";

import { agentWalletFor } from "../src/runtime/agent-wallet.ts";
import {
  buildAgentPaymentRequirements,
  createFacilitator,
  requirePayment,
  settlePayment,
  settleResponseHeader,
} from "../src/http/x402-v2.ts";

const ORCL_VAULT = "0x1c1fa59c0b6e631a47c7ec4717af3a0b7bfdb382" as const;
const PRICE = "10000"; // $0.01 (6dp)
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const net = resolveNetwork({}); // testnet (Base Sepolia)
  const facilitator = createFacilitator(net);
  const pub = createPublicClient({ chain: baseSepolia, transport: http(net.base.rpcUrl) });

  // ── server: our v2 primitives + real facilitator ──
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const resource = new URL(req.url).href;
      const hdr = req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT");
      const requirements = buildAgentPaymentRequirements(net, { priceSmallest: PRICE, payTo: ORCL_VAULT, resource });
      const gate = await requirePayment({ paymentHeader: hdr, resource, requirements, facilitator });
      if (!gate.ok) return gate.response;
      // "work" happens here; then settle
      const settle = await settlePayment({ facilitator, payload: gate.payload, requirements: gate.requirements });
      return new Response(JSON.stringify({ ok: true, payer: gate.payer, settle }), {
        headers: { "content-type": "application/json", "PAYMENT-RESPONSE": settleResponseHeader(settle) },
      });
    },
  });
  const endpoint = `http://localhost:${server.port}/x402/infer?tokenId=3`;
  console.log(`[server] up at ${endpoint}`);
  console.log(`[net] usdc=${net.base.usdc} facilitator=${net.x402.facilitatorUrl} network=${net.x402.network}`);

  // ── client: AUDIT's wallet pays via x402 v2 ──
  const account = agentWalletFor(process.env["OPERATOR_PRIVATE_KEY"] as `0x${string}`, 1n);
  console.log(`[client] AUDIT wallet = ${account.address}`);
  const client = new x402Client().register(net.x402.network, new ExactEvmScheme(toClientEvmSigner(account)));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  const vaultBefore = (await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [ORCL_VAULT] })) as bigint;
  console.log(`[before] ORCL vault USDC = ${formatUnits(vaultBefore, 6)}`);

  console.log(`[pay] sending x402 v2 payment…`);
  const res = await fetchWithPay(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await res.json();
  console.log(`[pay] status=${res.status} body=${JSON.stringify(body).slice(0, 300)}`);

  // settlement is async on-chain; poll the vault balance for the delta
  let vaultAfter = vaultBefore;
  for (let i = 0; i < 15 && vaultAfter <= vaultBefore; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    vaultAfter = (await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [ORCL_VAULT] })) as bigint;
  }
  const delta = vaultAfter - vaultBefore;
  console.log(`[after] ORCL vault USDC = ${formatUnits(vaultAfter, 6)}  (delta ${formatUnits(delta, 6)})`);
  console.log(delta === BigInt(PRICE) ? "✅ REAL x402 v2 PAYMENT SETTLED ON BASE SEPOLIA" : `⚠️ delta ${delta} != expected ${PRICE}`);

  server.stop(true);
}

main().catch((e) => { console.error("smoke failed:", e); process.exit(1); });
