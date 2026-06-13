/**
 * Pay the REAL running operator's /x402/infer endpoint via x402 v2.
 * Proves the server.ts swap end-to-end: 402 -> sign -> settle -> callId.
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/pay-real-operator.ts'
 */
import { resolveNetwork } from "@stratum/shared";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { agentWalletFor } from "../src/runtime/agent-wallet.ts";

const ORCL_VAULT = "0x1c1fa59c0b6e631a47c7ec4717af3a0b7bfdb382";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

async function main() {
  const net = resolveNetwork({});
  const account = agentWalletFor(process.env["OPERATOR_PRIVATE_KEY"] as `0x${string}`, 1n);
  const client = new x402Client().register(net.x402.network, new ExactEvmScheme(toClientEvmSigner(account)));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const pub = createPublicClient({ chain: baseSepolia, transport: http(net.base.rpcUrl) });

  const before = (await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [ORCL_VAULT] })) as bigint;
  console.log(`[before] ORCL vault = ${formatUnits(before, 6)} USDC`);
  console.log(`[client] AUDIT ${account.address} paying real operator /x402/infer tokenId=3 …`);

  const res = await fetchWithPay("http://localhost:8402/x402/infer?tokenId=3", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokenId: 3, input: "ping", subscriber: account.address }),
  });
  const body = await res.json();
  console.log(`[pay] status=${res.status} body=${JSON.stringify(body).slice(0, 300)}`);

  let after = before;
  for (let i = 0; i < 12 && after <= before; i++) { await new Promise((r) => setTimeout(r, 2000)); after = (await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [ORCL_VAULT] })) as bigint; }
  console.log(`[after] ORCL vault = ${formatUnits(after, 6)} USDC (delta ${formatUnits(after - before, 6)})`);
  console.log(res.status === 200 && after > before ? "✅ REAL OPERATOR x402 v2 PAID + SETTLED" : "⚠️ check above");
}
main().catch((e) => { console.error("failed:", e); process.exit(1); });
