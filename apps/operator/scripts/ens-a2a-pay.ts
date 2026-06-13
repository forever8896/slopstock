/**
 * Agent-to-agent payment, discovered + verified through ENS alone.
 *
 * The bounty's headline flow, end to end:
 *   1. DISCOVER  — resolve the peer's x402 endpoint from its mainnet ENS records (ENSIP-26)
 *   2. VERIFY    — ENSIP-25: check the peer's ENS name attests its ERC-8004 registration
 *                  (and prove a FORGED agentId is rejected)
 *   3. PAY       — only if verified, settle a real x402 v2 USDC payment and get the response
 *
 * ENS records live on Ethereum mainnet; the x402 settlement runs on Base Sepolia
 * against the live operator. The peer's published endpoint is its paywall URL;
 * we settle against the running operator instance for this demo.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/ens-a2a-pay.ts [peerEns] [peerAgentId] [peerTokenId]'
 */

import { resolveNetwork, encodeInteropAddress, CHAIN_TYPE_EIP155, type Hex } from "@stratum/shared";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { agentWalletFor } from "../src/runtime/agent-wallet.ts";
import { resolveAgent, verifyAgent } from "../src/store/ens-agent-resolver.ts";

const OPERATOR_URL = process.env["OPERATOR_URL"] ?? "http://localhost:8402";
const L1_RPC = process.env["L1_RPC"] ?? "https://ethereum-rpc.publicnode.com";
const REGISTRY_8004 = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Hex; // Base mainnet IdentityRegistry

const peer = (process.argv[2] ?? "oracles.slopstock.eth").toLowerCase();
const peerAgentId = process.argv[3] ?? "55229";
const peerTokenId = process.argv[4] ?? "3";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const net = resolveNetwork({});
  const payer = agentWalletFor(process.env["OPERATOR_PRIVATE_KEY"] as Hex, 1n); // AUDIT's wallet
  console.log(`\n━━━ ENS-discovered, ENSIP-25-verified agent-to-agent payment ━━━`);
  console.log(`caller : AUDIT (${payer.address})`);
  console.log(`peer   : ${peer}\n`);

  // ── 1. DISCOVER via mainnet ENS ───────────────────────────────────────────
  console.log("1. DISCOVER — resolve peer via mainnet ENS (ENSIP-26)");
  const resolved = await resolveAgent(peer, { network: "mainnet", rpcUrl: L1_RPC });
  console.log(`   agent-endpoint[x402] : ${resolved.endpointX402 ?? "(none)"}`);
  console.log(`   addr (vault)         : ${resolved.vaultAddress ?? "(none)"}`);
  console.log(`   agent-context        : ${(resolved.agentContext ?? "").slice(0, 70)}…`);
  if (!resolved.endpointX402) { console.error("   ❌ no x402 endpoint in ENS — cannot proceed"); process.exit(1); }

  // ── 2. VERIFY via ENSIP-25 (gates payment) ────────────────────────────────
  console.log("\n2. VERIFY — ENSIP-25 registration attestation");
  const interop = encodeInteropAddress(CHAIN_TYPE_EIP155, 8453, REGISTRY_8004);
  const v = await verifyAgent(peer, interop, peerAgentId, { network: "mainnet", rpcUrl: L1_RPC });
  console.log(`   claimed agentId ${peerAgentId}: verified=${v.verified} ${v.verified ? `value="${v.recordValue}"` : `(${v.reason})`}`);
  const forged = await verifyAgent(peer, interop, "999999", { network: "mainnet", rpcUrl: L1_RPC });
  console.log(`   forged  agentId 999999: verified=${forged.verified}  ← a forged claim is refused`);
  if (!v.verified) { console.error("   ❌ ENSIP-25 failed — refusing to pay an unverified agent"); process.exit(1); }
  console.log("   ✅ verified — payment authorized");

  // ── 3. PAY via x402 v2 (only because verified) ────────────────────────────
  console.log("\n3. PAY — x402 v2 settlement + peer response");
  const client = new x402Client().register(net.x402.network, new ExactEvmScheme(toClientEvmSigner(payer)));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const res = await fetchWithPay(`${OPERATOR_URL}/x402/infer?tokenId=${peerTokenId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokenId: Number(peerTokenId), subscriber: payer.address, input: "What is the live USD price of ETH? One sentence." }),
  });
  const pay = (await res.json()) as { callId?: string; settlementTx?: string };
  console.log(`   x402 status=${res.status} settlementTx=${pay.settlementTx ?? "(none)"}`);
  if (!pay.callId) { console.error(`   ❌ payment failed: ${JSON.stringify(pay).slice(0, 200)}`); process.exit(1); }

  let out: { status?: string; output?: string; receipt?: { signature?: string } } = {};
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${OPERATOR_URL}/x402/calls/${pay.callId}`);
    out = (await r.json()) as typeof out;
    if (out.status === "complete" || out.status === "error") break;
    await sleep(2000);
  }
  console.log(`   peer response: ${(out.output ?? "(none)").slice(0, 160)}`);
  console.log(`   signed receipt: ${out.receipt?.signature ? out.receipt.signature.slice(0, 18) + "…" : "(none)"}`);

  const ok = v.verified && !forged.verified && res.status === 200 && !!out.output;
  console.log(`\n${ok ? "✅" : "❌"} discovered ${peer} via ENS → ENSIP-25 verified (#${peerAgentId}) → paid over x402${pay.settlementTx ? ` (${pay.settlementTx})` : ""}`);
}

main().catch((e) => { console.error("[ens-a2a] fatal:", e?.message ?? e); process.exit(1); });
