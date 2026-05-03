/**
 * HTTP gateway built on Bun.serve.
 *
 * Routes:
 *
 *   POST /x402/infer
 *     - No X-PAYMENT-V1-RESPONSE header → return 402 with payment instructions
 *     - With a valid receipt → run inference, persist receipt, return JSON
 *
 *   GET /healthz
 *     - Liveness for AXL bridge / load balancers.
 *
 *   GET /profile/:tokenId
 *     - Chain-driven agent profile (AgentRegistry + iNFT).
 *
 *   GET /receipts?tokenId=N&subscriber=0x…
 *     - Recent inference receipts. Used by the web app's loadInferences loader.
 *
 * CORS is permissive so the dev frontend can hit this directly.
 */

import { agentNftAbi } from "../chain/abis.ts";
import type { AgentInfoCache, Clients } from "../chain/clients.ts";
import type { ReceiptSigner } from "../compute/receipt.ts";
import type { OperatorConfig } from "../config.ts";
import { handleProfile } from "../mcp/tools.ts";
import {
  attachFinance,
  getDynamicAgent,
  listDynamicAgents,
  registerDynamicAgent,
  type DynamicAgent,
} from "../store/dynamic-registry.ts";
import { deployFinanceStack } from "../store/finance-deploy.ts";
import type { RuntimeRouter } from "../runtime/index.ts";
import { RuntimeError } from "../runtime/index.ts";
import { listReceipts, recordReceipt } from "../store/receipts.ts";
import { priceForToken } from "../runtime/pricing.ts";
import { build402Response, parsePaymentHeader, type PaymentChallenge, validateReceipt } from "./x402.ts";

export interface HttpDeps {
  config: OperatorConfig;
  clients: Clients;
  runtimes: RuntimeRouter;
  receiptSigner: ReceiptSigner;
  agentInfo: AgentInfoCache;
  defaultVaultAddress: `0x${string}`;
  agentNftAddress: `0x${string}`;
  agentRegistryAddress: `0x${string}`;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT-V1-RESPONSE",
  "Access-Control-Expose-Headers": "X-PAYMENT-V1",
};

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, bigintReplacer, 2), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

export function startHttpServer(deps: HttpDeps) {
  return Bun.serve({
    port: deps.config.HTTP_PORT,
    async fetch(req: Request) {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(req.url);

      if (url.pathname === "/healthz") {
        return withCors(json({ ok: true, operator: deps.clients.account.address }));
      }

      const profileMatch = url.pathname.match(/^\/profile\/(\d+)$/);
      if (profileMatch && req.method === "GET") {
        return withCors(await handleProfileRoute(profileMatch[1]!, deps));
      }

      if (url.pathname === "/receipts" && req.method === "GET") {
        return withCors(handleReceiptsRoute(url, deps));
      }

      if (url.pathname === "/x402/infer" && req.method === "POST") {
        return withCors(await handleInfer(req, deps));
      }

      if (url.pathname === "/agents/register" && req.method === "POST") {
        return withCors(await handleRegisterAgent(req));
      }

      if (url.pathname === "/agents" && req.method === "GET") {
        return withCors(await handleListAgents());
      }

      if (url.pathname === "/agents/test" && req.method === "POST") {
        return withCors(await handleTestAgent(req, deps));
      }

      const financeMatch = url.pathname.match(/^\/agents\/(\d+)\/deploy-finance$/);
      if (financeMatch && req.method === "POST") {
        return withCors(await handleDeployFinance(financeMatch[1]!, deps));
      }

      return withCors(new Response("not found", { status: 404 }));
    },
  });
}

async function handleRegisterAgent(req: Request): Promise<Response> {
  let body: Partial<DynamicAgent>;
  try {
    body = (await req.json()) as Partial<DynamicAgent>;
  } catch {
    return json({ error: "invalid json body" }, { status: 400 });
  }

  const required: Array<keyof DynamicAgent> = [
    "tokenId",
    "ticker",
    "description",
    "systemPrompt",
    "model",
    "perCallSmallest",
    "creator",
    "txHash",
  ];
  for (const k of required) {
    if (!body[k]) return json({ error: `missing field: ${k}` }, { status: 400 });
  }

  const perCallSmallest = body.perCallSmallest!;
  const perCallHuman =
    body.perCallHuman ??
    `$${(Number(perCallSmallest) / 1e6).toFixed(2)}`;

  // First-class shape, populated regardless of what the client sent.
  const record: DynamicAgent = {
    tokenId: String(body.tokenId),
    ticker: String(body.ticker).toUpperCase(),
    description: String(body.description),
    systemPrompt: String(body.systemPrompt),
    model: String(body.model),
    perCallSmallest,
    perCallHuman,
    runtime: body.runtime === "hermes" ? "hermes" : "openai-compat",
    creator: String(body.creator),
    txHash: String(body.txHash),
    createdAt: Math.floor(Date.now() / 1000),
  };

  await registerDynamicAgent(record);
  return json({ ok: true, agent: record });
}

async function handleListAgents(): Promise<Response> {
  const agents = await listDynamicAgents();
  return json({ agents });
}

async function handleDeployFinance(tokenIdStr: string, deps: HttpDeps): Promise<Response> {
  const agent = await getDynamicAgent(tokenIdStr);
  if (!agent) return json({ error: `tokenId ${tokenIdStr} not in dynamic registry — call /agents/register first` }, { status: 404 });
  if (agent.finance) return json({ ok: true, agent, alreadyDeployed: true });
  if (!deps.config.DEPLOYER_PRIVATE_KEY) {
    return json({ error: "operator missing DEPLOYER_PRIVATE_KEY env" }, { status: 503 });
  }

  try {
    const pricePerShareUsd = ((Number(agent.perCallSmallest) / 1e6) * 10).toFixed(2);
    const result = await deployFinanceStack({
      tokenId: agent.tokenId,
      ticker: agent.ticker,
      pricePerShareUsd,
      maxShares: "100000",
      creator: agent.creator as `0x${string}`,
      deployerKey: deps.config.DEPLOYER_PRIVATE_KEY as `0x${string}`,
      rpcUrl: deps.config.BASE_RPC_URL,
    });
    const finance = {
      shareToken: result.shareToken,
      revenueVault: result.revenueVault,
      ipoSale: result.ipoSale,
      pricePerShareUsd,
      maxShares: "100000",
      deployedAt: Math.floor(Date.now() / 1000),
    };
    const updated = await attachFinance(agent.tokenId, finance);
    return json({ ok: true, agent: updated, txHashes: result.txHashes });
  } catch (err) {
    console.error("[finance-deploy] failed:", err);
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Test endpoint: runs the agent's runtime without payment, used by the
 * /launch page so a creator can verify their freshly-minted agent works.
 * No receipts, no chain writes — just exercise the runtime.
 */
async function handleTestAgent(req: Request, deps: HttpDeps): Promise<Response> {
  let body: { tokenId?: string | number; input?: string };
  try {
    body = (await req.json()) as { tokenId?: string | number; input?: string };
  } catch {
    return json({ error: "invalid json body" }, { status: 400 });
  }
  if (body.tokenId === undefined || body.tokenId === null || !body.input) {
    return json({ error: "tokenId and input required" }, { status: 400 });
  }
  const tokenId = typeof body.tokenId === "string" ? BigInt(body.tokenId) : BigInt(body.tokenId);
  const subscriber: `0x${string}` = "0x0000000000000000000000000000000000000000";

  try {
    const runtime = await deps.runtimes.forToken(tokenId);
    await runtime.load({ tokenId });
    const out = await runtime.runTask({
      tokenId,
      subscriber,
      input: body.input,
      paymentReceiptId: "test-no-payment",
    });
    return json({
      ok: true,
      output: out.output,
      model: out.model,
      tokenId: tokenId.toString(),
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

async function handleProfileRoute(tokenIdStr: string, deps: HttpDeps): Promise<Response> {
  try {
    const profile = await handleProfile(
      { tokenId: tokenIdStr },
      {
        config: deps.config,
        clients: deps.clients,
        runtimes: deps.runtimes,
        receiptSigner: deps.receiptSigner,
        agentInfo: deps.agentInfo,
        agentNftAddress: deps.agentNftAddress,
        agentRegistryAddress: deps.agentRegistryAddress,
      },
    );
    return json(profile);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}

function handleReceiptsRoute(url: URL, _deps: HttpDeps): Response {
  const tokenIdRaw = url.searchParams.get("tokenId");
  const subscriber = url.searchParams.get("subscriber") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const tokenId = tokenIdRaw ? BigInt(tokenIdRaw) : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const receipts = listReceipts({ tokenId, subscriber, limit });
  return json({ receipts });
}

async function handleInfer(req: Request, deps: HttpDeps): Promise<Response> {
  // Parse body first so the 402 challenge can be specific to the tokenId.
  // We tolerate the "tokenId in query string OR body" case so callers can
  // probe the challenge without a full body.
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("tokenId");

  let body: { tokenId?: string | number; input?: string; subscriber?: `0x${string}` } = {};
  try {
    if (req.headers.get("Content-Length") !== "0") {
      body = await req.json();
    }
  } catch {
    body = {};
  }

  const rawTokenId = body.tokenId ?? queryToken;
  if (rawTokenId === undefined || rawTokenId === null) {
    return new Response(JSON.stringify({ error: "tokenId required" }), { status: 400 });
  }
  const tokenId = typeof rawTokenId === "string" ? BigInt(rawTokenId) : BigInt(rawTokenId);

  // Look up vault + price for this specific agent.
  const info = await deps.agentInfo.forToken(tokenId);
  const recipient = (info?.vaultBase ?? deps.defaultVaultAddress) as `0x${string}`;
  const pricing = priceForToken(tokenId);

  const challenge: PaymentChallenge = {
    network: "base",
    asset: "USDC",
    amount: pricing.perCallSmallest,
    recipient,
  };

  const receipt = parsePaymentHeader(req.headers.get("X-PAYMENT-V1-RESPONSE"));
  if (!receipt) return build402Response(challenge);

  // Need full body now for the actual inference.
  if (!body.input || !body.subscriber) {
    return new Response(JSON.stringify({ error: "input and subscriber required" }), { status: 400 });
  }

  const validation = await validateReceipt(receipt, challenge, deps.config, deps.clients);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.reason }), {
      status: 402,
      headers: { "Content-Type": "application/json", "X-PAYMENT-V1": JSON.stringify(challenge) },
    });
  }

  const callId = crypto.randomUUID();
  const subscriber = body.subscriber;

  // Onchain authorizeUsage grant in parallel with the agent task.
  const grantPromise = grantUsage(deps, tokenId, subscriber);

  // Pick the runtime for THIS agent.
  const runtime = await deps.runtimes.forToken(tokenId);

  let taskOutput;
  try {
    await runtime.load({ tokenId });
    taskOutput = await runtime.runTask({
      tokenId,
      subscriber,
      input: body.input,
      paymentReceiptId: validation.receiptId,
    });
  } catch (err) {
    if (err instanceof RuntimeError) {
      return new Response(
        JSON.stringify({ error: `agent runtime unavailable: ${err.message}` }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    throw err;
  }

  const inferenceReceipt = await deps.receiptSigner.build(
    runtime.kind,
    taskOutput,
    { tokenId, subscriber, paymentReceiptId: validation.receiptId },
    callId,
  );
  recordReceipt(inferenceReceipt);

  const grantTx = await grantPromise;

  return json({ callId, output: taskOutput.output, receipt: inferenceReceipt, authorizeUsageTx: grantTx });
}

/**
 * Grant the subscriber an on-chain authorizeUsage license for 1 hour. Operator
 * must be approvedForAll (or per-token approved) by the iNFT owner; if it
 * isn't, the call reverts with NotOwnerOrApproved and we log + continue.
 */
async function grantUsage(
  deps: HttpDeps,
  tokenId: bigint,
  subscriber: `0x${string}`,
): Promise<`0x${string}` | null> {
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  try {
    const hash = await deps.clients.zgWallet.writeContract({
      account: deps.clients.account,
      chain: deps.clients.zgWallet.chain,
      address: deps.agentNftAddress,
      abi: agentNftAbi,
      functionName: "authorizeUsage",
      args: [tokenId, subscriber, expiresAt],
    });
    console.log(`[operator] authorizeUsage tx ${hash} for ${subscriber} on tokenId ${tokenId}`);
    return hash;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[operator] authorizeUsage failed (continuing): ${msg.slice(0, 200)}`);
    return null;
  }
}
