/**
 * FULL END-TO-END LOOP on the NEW launch infrastructure — the
 * "agentic commerce is in the room" proof, against a freshly-launched agent.
 *
 * Launches a brand-new agent through the permissionless flow, then drives the
 * entire commerce loop against its fresh contracts, asserting at every boundary:
 *
 *   0. launch — POST /agents/register → operator deploys a fresh
 *               ShareToken + RevenueVault + IPOSale on Base Sepolia, mints 1M
 *               shares to `creator`. Poll /agents/:id/deploy-finance.
 *   1. pay    — subscriber pays /x402/infer over x402 v2            (HTTP 200 + callId + settlementTx)
 *   2. infer  — the harness runs and returns a SIGNED receipt        (poll /x402/calls/:callId → complete)
 *   3. settle — USDC actually lands in the new RevenueVault          (on-chain balance delta > 0)
 *   4. snap   — RevenueVault.snap() captures the balance             (snapshotCount increments)
 *   5. claim  — the shareholder (creator) is paid pro-rata           (holder USDC delta == pendingFor)
 *
 * This targets the NEW infra only — no legacy AUDIT/MEMER/ORCL vaults.
 *
 * KNOWN GATE: finance-deploy.ts binds the new vault to USDC_BASE_SEPOLIA
 * (TestnetUSDC, a plain ERC20). x402 v2 settles in Circle USDC (EIP-3009).
 * If those differ, settlement lands an asset the vault doesn't count → step 3/4
 * fail with delta 0 / snap NoBalance. The script reads paymentAsset on-chain and
 * reports the mismatch instead of guessing, so the run pinpoints exactly that.
 *
 * Prereqs (fails loudly with guidance if missing):
 *   - operator running on :8402 with DEPLOYER_PRIVATE_KEY set (funds the deploy)
 *   - payer wallet funded with the x402 settlement asset (Circle USDC)
 *   - DEPLOYER/OPERATOR account funded with Base Sepolia ETH (snap + distributeTo gas)
 *
 * Run:
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-e2e-full-loop.ts'
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  getAddress,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { resolveNetwork } from "@stratum/shared";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";

import { agentWalletFor } from "../src/runtime/agent-wallet.ts";

// ─── ABIs (only what we call) ────────────────────────────────────────────────
const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const vaultAbi = [
  { type: "function", name: "paymentAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "snapshotCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "snapshotAt", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint64" }] },
  { type: "function", name: "pendingFor", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "snap", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "distributeTo", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [] },
  { type: "event", name: "Snapped", inputs: [{ name: "snapshotId", type: "uint256", indexed: true }, { name: "timepoint", type: "uint256", indexed: false }, { name: "balance", type: "uint256", indexed: false }] },
] as const;

const shareAbi = [
  { type: "function", name: "getPastVotes", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const OPERATOR_URL = process.env["OPERATOR_URL"] ?? "http://localhost:8402";

function die(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const failures: string[] = [];
  const ok = (label: string, cond: boolean, detail = "") => {
    console.log(`${cond ? "  ✅" : "  ❌"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures.push(label);
  };

  const key = process.env["OPERATOR_PRIVATE_KEY"] as Hex | undefined;
  const dkey = process.env["DEPLOYER_PRIVATE_KEY"] as Hex | undefined;
  if (!key) die("OPERATOR_PRIVATE_KEY not set (load .env first)");
  if (!dkey) die("DEPLOYER_PRIVATE_KEY not set (load .env first)");

  const net = resolveNetwork({}); // testnet (Base Sepolia)
  const pub = createPublicClient({ chain: baseSepolia, transport: http(net.base.rpcUrl) });
  // gas account = deployer (holds Base Sepolia ETH); also the share creator/claimant.
  const gasAccount = privateKeyToAccount(dkey); // pays gas for snap + distributeTo
  const wallet = createWalletClient({ account: gasAccount, chain: baseSepolia, transport: http(net.base.rpcUrl) });
  const payer = agentWalletFor(key, 1n); // AUDIT wallet — funded with Circle USDC; acts as subscriber

  // creator = the shareholder we'll verify gets paid (receives all 1M shares).
  const creator = gasAccount.address;

  // Fresh tokenId for this launch. Real launches mint an iNFT on 0G first; for a
  // Base-Sepolia infra test the operator only uses tokenId as a constructor arg.
  const tokenId = process.env["E2E_TOKEN_ID"] ?? String(900000 + (Date.now() % 90000));
  const ticker = `E2E${tokenId.slice(-4)}`;

  console.log(`\n━━━ FULL E2E LOOP (new infra) — launching token ${tokenId} (${ticker}) ━━━`);
  console.log(`operator   ${OPERATOR_URL}`);
  console.log(`creator    ${creator} (shareholder)`);
  console.log(`payer      ${payer.address} (subscriber)\n`);

  // ── 0a. preflight ────────────────────────────────────────────────────────────
  console.log("0. launch a fresh agent");
  try {
    const h = await fetch(`${OPERATOR_URL}/healthz`, { signal: AbortSignal.timeout(4000) });
    if (!h.ok) die(`operator /healthz → ${h.status}`);
  } catch {
    die(`operator not reachable at ${OPERATOR_URL} — start it:  bun run apps/operator/src/index.ts`);
  }

  // ── 0b. register (auto-kicks the Base Sepolia finance deploy) ──────────────────
  const regRes = await fetch(`${OPERATOR_URL}/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tokenId,
      ticker,
      description: "Ephemeral end-to-end loop test agent.",
      systemPrompt: "You are a test agent. Reply in one short sentence.",
      model: "deepseek-v4-flash",
      backend: "0g-compute", // route inference to the sealed 0G mainnet v4-flash brain
      perCallSmallest: "10000", // $0.01
      creator,
      txHash: `0x${"e2e".padEnd(64, "0")}`, // placeholder mint ref for the infra test
    }),
  });
  const regBody = (await regRes.json()) as { ok?: boolean; status?: string; error?: string };
  ok("register accepted", regRes.ok && regBody.ok !== false, regBody.error ?? regBody.status ?? `HTTP ${regRes.status}`);
  if (!regRes.ok) die(`register failed: ${JSON.stringify(regBody).slice(0, 300)}`);

  // ── 0c. poll finance deploy until the new vault exists ─────────────────────────
  let finance: { shareToken?: string; revenueVault?: string; ipoSale?: string } | undefined;
  for (let i = 0; i < 90; i++) {
    const r = await fetch(`${OPERATOR_URL}/agents/${tokenId}/deploy-finance`);
    const b = (await r.json()) as { status?: string; finance?: typeof finance; agent?: { finance?: typeof finance }; message?: string };
    const f = b.finance ?? b.agent?.finance;
    if (b.status === "complete" && f?.revenueVault) { finance = f; break; }
    if (b.status === "error") { ok("finance deployed", false, b.message ?? "deploy error"); break; }
    await sleep(2000);
  }
  ok("finance deployed", !!finance?.revenueVault, finance ? `vault=${finance.revenueVault} share=${finance.shareToken}` : "(timed out)");
  if (!finance?.revenueVault || !finance.shareToken) die("no finance stack — cannot continue (check DEPLOYER_PRIVATE_KEY + Base Sepolia ETH on the deployer)");

  const vault = getAddress(finance.revenueVault);
  const share = getAddress(finance.shareToken);

  // asset the new vault actually counts (immutable) vs. what x402 v2 settles in.
  const boundAsset = getAddress(await pub.readContract({ address: vault, abi: vaultAbi, functionName: "paymentAsset" }));
  const x402Asset = getAddress(net.base.usdc);
  const decimals = (await pub.readContract({ address: boundAsset, abi: erc20Abi, functionName: "decimals" })) as number;
  const fmt = (v: bigint) => `${formatUnits(v, decimals)} (${boundAsset.slice(0, 10)}…)`;
  ok("vault asset == x402 settlement asset", boundAsset === x402Asset, `vault=${boundAsset} x402=${x402Asset}`);
  if (boundAsset !== x402Asset) {
    console.log(`     ⚠ MISMATCH: x402 will settle ${x402Asset} but the vault only counts ${boundAsset}.`);
    console.log(`       → settlement won't register; snap() will revert NoBalance. Fix: finance-deploy.ts bind Circle USDC.`);
  }

  const vaultBefore = (await pub.readContract({ address: boundAsset, abi: erc20Abi, functionName: "balanceOf", args: [vault] })) as bigint;

  // ── 1. pay /x402/infer over x402 v2 ──────────────────────────────────────────
  console.log("\n1. pay — x402 v2 → /x402/infer");
  const client = new x402Client().register(net.x402.network, new ExactEvmScheme(toClientEvmSigner(payer)));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const payRes = await fetchWithPay(`${OPERATOR_URL}/x402/infer?tokenId=${tokenId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokenId: Number(tokenId), subscriber: payer.address, input: "ping — confirm you are running." }),
  });
  const payBody = (await payRes.json()) as { callId?: string; settlementTx?: string };
  ok("HTTP 200", payRes.status === 200, `status=${payRes.status}`);
  ok("callId returned", !!payBody.callId, payBody.callId ?? "(none)");
  ok("settlementTx returned", !!payBody.settlementTx, payBody.settlementTx ?? "(none)");
  if (!payBody.callId) die(`pay leg failed: ${JSON.stringify(payBody).slice(0, 300)}`);

  // ── 2. infer — poll for the signed receipt ───────────────────────────────────
  console.log("\n2. infer — poll /x402/calls/:callId");
  let result: { status?: string; output?: string; receipt?: { signature?: string; runtime?: string; model?: string } } = {};
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${OPERATOR_URL}/x402/calls/${payBody.callId}`);
    result = (await r.json()) as typeof result;
    if (result.status === "complete" || result.status === "error") break;
    await sleep(2000);
  }
  ok("inference complete", result.status === "complete", `status=${result.status}`);
  ok("output present", !!result.output?.length, result.output ? `${result.output.slice(0, 70)}…` : "(empty)");
  ok("receipt signed", !!result.receipt?.signature, result.receipt?.signature ? `${result.receipt.signature.slice(0, 18)}… runtime=${result.receipt.runtime}` : "(unsigned)");

  // ── 3. settle — USDC landed in the new vault ─────────────────────────────────
  console.log("\n3. settle — vault balance delta");
  let vaultAfter = vaultBefore;
  for (let i = 0; i < 15 && vaultAfter <= vaultBefore; i++) {
    await sleep(2000);
    vaultAfter = (await pub.readContract({ address: boundAsset, abi: erc20Abi, functionName: "balanceOf", args: [vault] })) as bigint;
  }
  ok("vault received funds", vaultAfter > vaultBefore, `before=${fmt(vaultBefore)} after=${fmt(vaultAfter)}`);

  // ── 4. snap ──────────────────────────────────────────────────────────────────
  console.log("\n4. snap — RevenueVault.snap()");
  let snapshotId = -1n;
  try {
    const tx = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "snap", args: [] });
    const rcpt = await pub.waitForTransactionReceipt({ hash: tx });
    // Derive snapshotId from the Snapped event in this receipt — robust against
    // RPC read-lag (reading snapshotCount right after mining can race).
    const ev = parseEventLogs({ abi: vaultAbi, logs: rcpt.logs, eventName: "Snapped" })[0];
    if (ev) snapshotId = (ev.args as { snapshotId: bigint }).snapshotId;
    ok("snapshot created", rcpt.status === "success" && snapshotId >= 0n, `id=${snapshotId} status=${rcpt.status} tx=${tx}`);
  } catch (e) {
    ok("snapshot created", false, `snap() reverted: ${(e as Error).message.slice(0, 110)}`);
  }

  // ── 5. claim — shareholder paid pro-rata ─────────────────────────────────────
  console.log("\n5. claim — distributeTo(snapshotId, creator)");
  void share; void shareAbi; // shares verified implicitly via pendingFor > 0
  if (snapshotId >= 0n) {
    // The public Base Sepolia RPC is load-balanced and lags after the snap write,
    // so a read can hit a node that hasn't indexed the new snapshot yet (reverts
    // InvalidSnapshot 0x40f08cfe). Retry pendingFor until the snapshot is visible.
    let pending = -1n;
    for (let i = 0; i < 15; i++) {
      try { pending = (await pub.readContract({ address: vault, abi: vaultAbi, functionName: "pendingFor", args: [snapshotId, creator] })) as bigint; break; }
      catch { await sleep(2500); }
    }
    ok("snapshot visible + pro-rata computed", pending >= 0n, pending >= 0n ? `pending=${fmt(pending)}` : "not visible after 15 retries");
    ok("creator has a pending payout", pending > 0n, pending >= 0n ? `pending=${fmt(pending)}` : "n/a");
    if (pending > 0n) {
      const holderBefore = (await pub.readContract({ address: boundAsset, abi: erc20Abi, functionName: "balanceOf", args: [creator] })) as bigint;
      try {
        const tx = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "distributeTo", args: [snapshotId, creator] });
        await pub.waitForTransactionReceipt({ hash: tx });
        let holderAfter = holderBefore;
        for (let i = 0; i < 8 && holderAfter <= holderBefore; i++) {
          await sleep(2500);
          holderAfter = (await pub.readContract({ address: boundAsset, abi: erc20Abi, functionName: "balanceOf", args: [creator] })) as bigint;
        }
        const delta = holderAfter - holderBefore;
        ok("shareholder paid pro-rata", delta === pending && delta > 0n, `delta=${fmt(delta)} expected=${fmt(pending)} tx=${tx}`);
      } catch (e) {
        ok("shareholder paid pro-rata", false, `distributeTo reverted: ${(e as Error).message.slice(0, 110)}`);
      }
    }
  } else {
    ok("claim leg", false, "skipped — no snapshot");
  }

  // ── verdict ───────────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (failures.length === 0) {
    console.log(`✅ FULL LOOP GREEN — launched ${ticker} → pay → infer → signed receipt → vault → snap → shareholder paid`);
  } else {
    console.log(`❌ ${failures.length} leg(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n[e2e] fatal:", e);
  process.exit(1);
});
