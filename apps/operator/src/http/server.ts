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
  attachEnsName,
  attachFinance,
  deleteDynamicAgent,
  getDynamicAgent,
  listDynamicAgents,
  registerDynamicAgent,
  type DynamicAgent,
} from "../store/dynamic-registry.ts";
import { recoverMessageAddress, type Hex } from "viem";
import { deployFinanceStack } from "../store/finance-deploy.ts";
import { provisionSecret, SecretNotConfiguredError } from "../store/secrets.ts";
import { parseCredentials } from "./register-helpers.ts";
import { registerSubname } from "../store/ens-subname.ts";
import type { RuntimeRouter } from "../runtime/index.ts";
import { RuntimeError } from "../runtime/index.ts";
import { listReceipts, recordReceipt } from "../store/receipts.ts";
import { priceForToken } from "../runtime/pricing.ts";
import {
  getOperatorOgStorage,
  OgStorageNotFoundError,
} from "../storage/og-storage-impl.ts";
import {
  resolveNetwork,
} from "@stratum/shared";
import {
  buildAgentPaymentRequirements,
  createFacilitator,
  requirePayment,
  settlePayment,
  settleResponseHeader,
} from "./x402-v2.ts";
import { readSplitConfig, resolvePayTo, forwardNetToVault } from "../funding/split-config.ts";
import { handleDemoScript } from "../agents/demo-script/http-handler.ts";
import { handleDrillCypher } from "../agents/drill-cypher/http-handler.ts";

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

// x402 v2 payment layer — DECOUPLED from the global NETWORK so payments can run
// on mainnet while 0G/ENS reads stay on their own network. X402_NETWORK overrides
// just the payment network; X402_FACILITATOR_URL points it at a facilitator for
// that network (e.g. a keyless mainnet facilitator). Falls back to global NETWORK.
const _x402Base = resolveNetwork({
  ...process.env,
  NETWORK: process.env["X402_NETWORK"] ?? process.env["NETWORK"] ?? "testnet",
});
const x402Net = process.env["X402_FACILITATOR_URL"]
  ? { ..._x402Base, x402: { ..._x402Base.x402, facilitatorUrl: process.env["X402_FACILITATOR_URL"] } }
  : _x402Base;
const x402Facilitator = createFacilitator(x402Net);

/**
 * In-memory tracking of in-flight x402 inference calls. /x402/infer kicks
 * off the runtime asynchronously and returns immediately with a callId; the
 * client polls /x402/calls/:callId until status flips. Sidesteps the
 * Railway proxy's 60s HTTP timeout for slow paths (mainnet TEE + cross-
 * agent x402 + Hermes can run 30-90s; we don't gamble on the proxy).
 */
type InFlightState =
  | { status: "running"; tokenId: string; subscriber: `0x${string}`; startedAt: number }
  | {
      status: "complete";
      output: string;
      receipt: unknown;
      callId: string;
      authorizeUsageTx: `0x${string}` | null;
      /** Compact execution transcript for the UI flow viz (tool calls, peer
       *  payments, on-chain reads). Safe to expose — never carries secrets. */
      steps: Array<{ kind: string; tool?: string; summary: string }>;
      completedAt: number;
    }
  | { status: "error"; message: string; completedAt: number };

const inFlight = new Map<string, InFlightState>();
const INFLIGHT_TTL_MS = 10 * 60 * 1000; // keep results 10 min for polling
function pruneInFlight(): void {
  const now = Date.now();
  for (const [k, v] of inFlight) {
    const stamp = (v as { startedAt?: number; completedAt?: number }).startedAt ?? (v as { startedAt?: number; completedAt?: number }).completedAt ?? 0;
    if (stamp && now - stamp > INFLIGHT_TTL_MS) inFlight.delete(k);
  }
}

/**
 * In-memory tracking of in-flight finance deploys (3 sequential contract
 * deploys on Base Sepolia, ~30-60s total). The web app fires-and-polls so
 * a flaky proxy / cold network doesn't surface as "Failed to fetch" mid-deploy.
 *
 * Keyed by tokenId (string). Idempotent: if a deploy is already running for
 * a tokenId, repeated POSTs just return the same status.
 */
type FinanceDeployState =
  | { status: "deploying"; tokenId: string; startedAt: number }
  | {
      status: "complete";
      tokenId: string;
      finance: {
        shareToken: `0x${string}`;
        revenueVault: `0x${string}`;
        ipoSale: `0x${string}`;
      };
      txHashes: { shareToken: `0x${string}`; revenueVault: `0x${string}`; ipoSale: `0x${string}` };
      ens?: { ensName: string; setAddrTx: string; setSubnodeTx: string | null };
      completedAt: number;
    }
  | { status: "error"; tokenId: string; message: string; completedAt: number };

const financeInFlight = new Map<string, FinanceDeployState>();
function pruneFinanceInFlight(): void {
  const now = Date.now();
  for (const [k, v] of financeInFlight) {
    const stamp = (v as { startedAt?: number; completedAt?: number }).startedAt ?? (v as { startedAt?: number; completedAt?: number }).completedAt ?? 0;
    // Keep "deploying" entries indefinitely; only TTL terminal states.
    if (v.status !== "deploying" && stamp && now - stamp > INFLIGHT_TTL_MS) financeInFlight.delete(k);
  }
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE",
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

      const callMatch = url.pathname.match(/^\/x402\/calls\/([0-9a-f-]{36})$/i);
      if (callMatch && req.method === "GET") {
        return withCors(handleInferResult(callMatch[1]!));
      }

      if (url.pathname === "/agents/register" && req.method === "POST") {
        return withCors(await handleRegisterAgent(req, deps));
      }

      if (url.pathname === "/agents" && req.method === "GET") {
        return withCors(await handleListAgents());
      }

      if (url.pathname === "/agents/test" && req.method === "POST") {
        return withCors(await handleTestAgent(req, deps));
      }

      if (url.pathname === "/og-storage/pin" && req.method === "POST") {
        return withCors(await handleOgStoragePin(req, deps));
      }

      const ogFetchMatch = url.pathname.match(/^\/og-storage\/([0-9a-fA-Fx]+)$/);
      if (ogFetchMatch && req.method === "GET") {
        return withCors(await handleOgStorageFetch(ogFetchMatch[1]!, deps));
      }

      const financeMatch = url.pathname.match(/^\/agents\/(\d+)\/deploy-finance$/);
      if (financeMatch && req.method === "POST") {
        return withCors(await handleDeployFinance(financeMatch[1]!, deps));
      }
      if (financeMatch && req.method === "GET") {
        return withCors(await handleDeployFinanceStatus(financeMatch[1]!));
      }

      const deleteAgentMatch = url.pathname.match(/^\/agents\/(\d+)$/);
      if (deleteAgentMatch && req.method === "DELETE") {
        return withCors(await handleDeleteAgent(deleteAgentMatch[1]!, req));
      }

      if (url.pathname === "/run/demo-script" && req.method === "POST") {
        return handleDemoScript(req, { net: x402Net, facilitator: x402Facilitator });
      }

      if (url.pathname === "/run/drill-cypher" && req.method === "POST") {
        return handleDrillCypher(req, { net: x402Net, facilitator: x402Facilitator, config: deps.config });
      }

      return withCors(new Response("not found", { status: 404 }));
    },
  });
}

export async function handleRegisterAgent(req: Request, deps: Pick<HttpDeps, "config">): Promise<Response> {
  type RegisterBody = {
    tokenId?: unknown;
    ticker?: unknown;
    description?: unknown;
    systemPrompt?: unknown;
    perCallSmallest?: unknown;
    /** Alternate to perCallSmallest: USD amount (e.g. "0.50") × 1e6 → perCallSmallest. */
    perCallUsd?: unknown;
    perCallHuman?: unknown;
    creator?: unknown;
    txHash?: unknown;
    /** Optional MCP-style tool definitions passed through to the agent record. */
    tools?: unknown;
    name?: unknown;
    /** Optional tool credentials to store in 1Claw at launch (plan 09). Each
     *  value is consumed here and NEVER persisted to our registry/manifest/logs. */
    credentials?: unknown;
    /** Optional: real ENS subname for this agent (e.g. "yield.slopstock.eth"). */
    ensName?: unknown;
    /** Optional: the TEE signer/measurement this agent attests to. */
    expectedTeeMeasurement?: unknown;
    /** Optional: pre-deployed finance contracts (else set via deploy-finance). */
    finance?: unknown;
  };
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return json({ error: "invalid json body" }, { status: 400 });
  }

  const required = ["tokenId", "ticker", "description", "systemPrompt", "creator", "txHash"] as const;
  for (const k of required) {
    if (!body[k]) return json({ error: `missing field: ${k}` }, { status: 400 });
  }

  // Accept either perCallSmallest or perCallUsd (USD × 1e6).
  let perCallSmallest: string;
  if (body.perCallSmallest) {
    perCallSmallest = String(body.perCallSmallest);
  } else if (body.perCallUsd) {
    perCallSmallest = String(Math.round(Number(body.perCallUsd) * 1e6));
  } else {
    return json({ error: "missing field: perCallSmallest (or perCallUsd)" }, { status: 400 });
  }

  const perCallHuman =
    body.perCallHuman != null
      ? String(body.perCallHuman)
      : `$${(Number(perCallSmallest) / 1e6).toFixed(2)}`;

  const record: DynamicAgent = {
    tokenId: String(body.tokenId),
    ticker: String(body.ticker).toUpperCase(),
    description: String(body.description),
    systemPrompt: String(body.systemPrompt),
    // model is not required in the slim contract; default empty — the runtime
    // selects the provider's TeeML model at call time via the 0g-compute backend.
    model: "",
    perCallSmallest,
    perCallHuman,
    runtime: "hermes",
    backend: "0g-compute",
    creator: String(body.creator),
    txHash: String(body.txHash),
    createdAt: Math.floor(Date.now() / 1000),
    ...(body.tools !== undefined ? { tools: body.tools } : {}),
    ...(body.ensName ? { ensName: String(body.ensName) } : {}),
    ...(body.expectedTeeMeasurement ? { expectedTeeMeasurement: String(body.expectedTeeMeasurement) } : {}),
    ...(body.finance ? { finance: body.finance as DynamicAgent["finance"] } : {}),
  };

  await registerDynamicAgent(record);

  // Provision tool credentials into 1Claw (plan 09). The plaintext values are
  // consumed here and never stored in our registry/manifest/logs. Non-fatal:
  // a missing 1Claw config or a single failed put must not block the launch
  // (the agent still works for non-credentialed tools). Leak-safe: we never log
  // the value, only the ref.
  let secretsProvisioned = 0;
  const creds = parseCredentials(body.credentials);
  if (creds.length > 0) {
    const tokenId = BigInt(record.tokenId);
    for (const c of creds) {
      try {
        await provisionSecret(c.ref, c.value, { tokenId, config: deps.config, service: c.ref });
        secretsProvisioned++;
      } catch (err) {
        const reason = err instanceof SecretNotConfiguredError ? "1Claw not configured" : (err as Error).message;
        console.warn(`[register] could not provision secret "${c.ref}" for token ${record.tokenId}: ${reason}`);
      }
    }
  }

  // Kick off the Base Sepolia finance stack immediately so it runs in parallel
  // with whatever the user does next on the /launch page. By the time they
  // see the "go live" step, ShareToken/RevenueVault/IPOSale are already
  // deploying — they just poll for completion. Idempotent + safe to retry.
  startFinanceDeployAsync(record.tokenId, deps as HttpDeps);

  return json({ ok: true, agent: record, financeStatus: "deploying", secretsProvisioned });
}

/**
 * Creator-only delete. Body: { signer, signedAt (ms), signature }.
 * Message format (must match the web client exactly):
 *   "delete agent <tokenId> at <signedAt>"
 *
 * Auth checks:
 *  1. recoverMessageAddress(signature) === signer
 *  2. signer.toLowerCase() === agent.creator.toLowerCase()
 *  3. signedAt within ±5 min of now (replay-window)
 *
 * Removes from registry only — on-chain iNFT/vault/IPO/ShareToken stay live.
 */
async function handleDeleteAgent(tokenId: string, req: Request): Promise<Response> {
  let body: { signer?: Hex; signedAt?: number; signature?: Hex };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid json body" }, { status: 400 });
  }
  const { signer, signedAt, signature } = body;
  if (!signer || !signedAt || !signature) {
    return json({ error: "missing signer | signedAt | signature" }, { status: 400 });
  }

  const skewMs = Math.abs(Date.now() - signedAt);
  if (skewMs > 5 * 60 * 1000) {
    return json({ error: `signedAt too old/skewed (${Math.round(skewMs / 1000)}s)` }, { status: 400 });
  }

  const agent = await getDynamicAgent(tokenId);
  if (!agent) return json({ error: `tokenId ${tokenId} not in dynamic registry` }, { status: 404 });

  const message = `delete agent ${tokenId} at ${signedAt}`;
  let recovered: Hex;
  try {
    recovered = await recoverMessageAddress({ message, signature });
  } catch (err) {
    return json(
      { error: `signature recovery failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  if (recovered.toLowerCase() !== signer.toLowerCase()) {
    return json({ error: "signature does not match signer" }, { status: 401 });
  }
  if (recovered.toLowerCase() !== agent.creator.toLowerCase()) {
    return json(
      { error: "only the creator may delete this agent", creator: agent.creator },
      { status: 403 },
    );
  }

  const removed = await deleteDynamicAgent(tokenId);
  return json({ ok: removed, tokenId });
}

async function handleOgStoragePin(req: Request, deps: HttpDeps): Promise<Response> {
  let body: { content?: string; contentType?: string; json?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid json body" }, { status: 400 });
  }
  const ogs = getOperatorOgStorage({ dataDir: deps.config.AGENTS_DATA_DIR });
  try {
    if (body.json !== undefined) {
      const result = await ogs.pinJson(body.json);
      return json({ ok: true, ...result });
    }
    if (typeof body.content === "string") {
      const result = await ogs.pinText(body.content, body.contentType ?? "text/plain");
      return json({ ok: true, ...result });
    }
    return json({ error: "either `content` or `json` is required" }, { status: 400 });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

async function handleOgStorageFetch(rootHashRaw: string, deps: HttpDeps): Promise<Response> {
  const ogs = getOperatorOgStorage({ dataDir: deps.config.AGENTS_DATA_DIR });
  try {
    const text = await ogs.fetchText(rootHashRaw);
    // Best-effort content-type sniff: JSON if it parses as such.
    let contentType = "text/plain";
    try {
      JSON.parse(text);
      contentType = "application/json";
    } catch {
      /* leave as text/plain */
    }
    return new Response(text, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    if (err instanceof OgStorageNotFoundError) {
      return json({ error: err.message }, { status: 404 });
    }
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

async function handleListAgents(): Promise<Response> {
  const agents = await listDynamicAgents();
  return json({ agents });
}

async function handleDeployFinance(tokenIdStr: string, deps: HttpDeps): Promise<Response> {
  const agent = await getDynamicAgent(tokenIdStr);
  if (!agent) return json({ error: `tokenId ${tokenIdStr} not in dynamic registry — call /agents/register first` }, { status: 404 });
  if (!deps.config.DEPLOYER_PRIVATE_KEY) {
    return json({ error: "operator missing DEPLOYER_PRIVATE_KEY env" }, { status: 503 });
  }

  // Agent already has finance — return immediately. ENS registration, if
  // missing, will be picked up the next time the background runner spins.
  if (agent.finance) {
    return json({ ok: true, status: "complete", agent, alreadyDeployed: true });
  }

  // Already in-flight: idempotent — just report status. Avoids double-deploys
  // when the web client retries on a flaky network.
  pruneFinanceInFlight();
  const existing = financeInFlight.get(tokenIdStr);
  if (existing && existing.status === "deploying") {
    return json({ ok: true, status: "deploying", agent, sinceMs: Date.now() - existing.startedAt });
  }

  // Kick off deploy in the BACKGROUND and return immediately. Client polls
  // GET /agents/:tokenId/deploy-finance until status flips to complete/error.
  // Sidesteps the ~60s edge-proxy HTTP timeout that surfaces as "Failed to
  // fetch" in the browser when the 3 sequential Base Sepolia deploys run long.
  startFinanceDeployAsync(tokenIdStr, deps);
  return json({ ok: true, status: "deploying", agent });
}

/**
 * Idempotent fire-and-forget: starts a finance deploy for the given tokenId
 * unless one is already in-flight or already complete on the agent record.
 * Safe to call from /agents/register and /agents/:tokenId/deploy-finance.
 */
function startFinanceDeployAsync(tokenIdStr: string, deps: HttpDeps): void {
  if (!deps.config.DEPLOYER_PRIVATE_KEY) return;
  const existing = financeInFlight.get(tokenIdStr);
  if (existing && existing.status === "deploying") return;

  financeInFlight.set(tokenIdStr, {
    status: "deploying",
    tokenId: tokenIdStr,
    startedAt: Date.now(),
  });
  void runFinanceDeployAsync(tokenIdStr, deps);
}

async function runFinanceDeployAsync(tokenIdStr: string, deps: HttpDeps): Promise<void> {
  try {
    const agent = await getDynamicAgent(tokenIdStr);
    if (!agent) {
      financeInFlight.set(tokenIdStr, {
        status: "error",
        tokenId: tokenIdStr,
        message: `tokenId ${tokenIdStr} not in dynamic registry`,
        completedAt: Date.now(),
      });
      return;
    }
    if (agent.finance) {
      financeInFlight.set(tokenIdStr, {
        status: "complete",
        tokenId: tokenIdStr,
        finance: {
          shareToken: agent.finance.shareToken as `0x${string}`,
          revenueVault: agent.finance.revenueVault as `0x${string}`,
          ipoSale: agent.finance.ipoSale as `0x${string}`,
        },
        txHashes: { shareToken: "0x" as `0x${string}`, revenueVault: "0x" as `0x${string}`, ipoSale: "0x" as `0x${string}` },
        completedAt: Date.now(),
      });
      return;
    }

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
    await attachFinance(agent.tokenId, finance);

    // Best-effort ENS subname under slopstock.eth — non-fatal.
    let ensResult: { ensName: string; setAddrTx: string; setSubnodeTx: string | null } | undefined;
    try {
      const reg = await registerSubname({
        ticker: agent.ticker,
        vaultAddress: result.revenueVault as `0x${string}`,
        creator: agent.creator as `0x${string}`,
        deployerKey: deps.config.DEPLOYER_PRIVATE_KEY as `0x${string}`,
        sepoliaRpcUrl: deps.config.SEPOLIA_RPC_URL,
      });
      await attachEnsName(agent.tokenId, reg.ensName);
      ensResult = { ensName: reg.ensName, setAddrTx: reg.setAddrTx, setSubnodeTx: reg.setSubnodeTx };
    } catch (err) {
      console.warn(
        `[finance-deploy] ENS subname registration failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    financeInFlight.set(tokenIdStr, {
      status: "complete",
      tokenId: tokenIdStr,
      finance: { shareToken: result.shareToken, revenueVault: result.revenueVault, ipoSale: result.ipoSale },
      txHashes: result.txHashes,
      ...(ensResult ? { ens: ensResult } : {}),
      completedAt: Date.now(),
    });
  } catch (err) {
    console.error(`[finance-deploy] tokenId=${tokenIdStr} failed:`, err);
    financeInFlight.set(tokenIdStr, {
      status: "error",
      tokenId: tokenIdStr,
      message: err instanceof Error ? err.message : String(err),
      completedAt: Date.now(),
    });
  }
}

async function handleDeployFinanceStatus(tokenIdStr: string): Promise<Response> {
  pruneFinanceInFlight();
  const state = financeInFlight.get(tokenIdStr);
  if (state) {
    if (state.status === "deploying") {
      return json({ status: "deploying", tokenId: tokenIdStr, sinceMs: Date.now() - state.startedAt });
    }
    if (state.status === "complete") {
      return json({
        status: "complete",
        tokenId: tokenIdStr,
        finance: state.finance,
        txHashes: state.txHashes,
        ...(state.ens ? { ens: state.ens } : {}),
      });
    }
    return json({ status: "error", tokenId: tokenIdStr, message: state.message }, { status: 500 });
  }
  // Fall back to the persisted registry if the in-memory tracker has no entry
  // (e.g. operator restarted after a successful deploy).
  const agent = await getDynamicAgent(tokenIdStr);
  if (!agent) return json({ status: "not-found" }, { status: 404 });
  if (agent.finance) {
    return json({
      status: "complete",
      tokenId: tokenIdStr,
      finance: {
        shareToken: agent.finance.shareToken,
        revenueVault: agent.finance.revenueVault,
        ipoSale: agent.finance.ipoSale,
      },
      txHashes: { shareToken: "", revenueVault: "", ipoSale: "" },
    });
  }
  return json({ status: "idle", tokenId: tokenIdStr });
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
  // Dynamic agents (permissionless mints) aren't in AgentRegistry on chain
  // — their vaults live only in the operator's local registry. Check there
  // FIRST before falling back to chain-side AgentRegistry, otherwise the
  // x402 challenge gets built against the wrong recipient and every paid
  // call to a dynamic agent 402s as "tx not paying our vault."
  const dyn = await getDynamicAgent(tokenId.toString());
  let recipient: `0x${string}`;
  if (dyn?.finance?.revenueVault) {
    recipient = dyn.finance.revenueVault as `0x${string}`;
  } else {
    const info = await deps.agentInfo.forToken(tokenId);
    recipient = (info?.vaultBase ?? deps.defaultVaultAddress) as `0x${string}`;
  }
  // Self-funding split (default OFF): when COMPUTE_SLICE_BPS + COMPUTE_RESERVE_ADDRESS
  // are set, route the call payment to the operator reserve instead of the vault;
  // the net is forwarded to the vault after settlement (see below). Inert otherwise.
  const splitCfg = readSplitConfig();
  const vaultRecipient = recipient;
  recipient = resolvePayTo(vaultRecipient, splitCfg);
  const pricing = priceForToken(tokenId);

  // x402 v2: build spec requirements (network + asset from getNetwork()) and gate
  // the request through the facilitator. No payment → 402 with PAYMENT-REQUIRED.
  const resource = req.url;
  const requirements = buildAgentPaymentRequirements(x402Net, {
    priceSmallest: pricing.perCallSmallest,
    payTo: recipient,
    resource,
  });
  const gate = await requirePayment({
    paymentHeader: req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT"),
    resource,
    requirements,
    facilitator: x402Facilitator,
  });
  if (!gate.ok) return gate.response;

  // Payment verified. Require the full body before we settle — don't charge for
  // a malformed request.
  if (!body.input || !body.subscriber) {
    return new Response(JSON.stringify({ error: "input and subscriber required" }), { status: 400 });
  }

  // Settle now (prepaid-API model): standard x402 clients expect settlement on
  // the paid response, and inference runs async (returns a callId to poll).
  const settle = await settlePayment({ facilitator: x402Facilitator, payload: gate.payload, requirements });
  if (!settle.success) {
    return new Response(JSON.stringify({ error: `settlement failed: ${settle.errorReason ?? "unknown"}` }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Self-funding split: payment landed in the operator reserve — forward the
  // shareholders' net to the vault (fire-and-forget; never blocks the response).
  // Inert unless the split is enabled. Needs OPERATOR_PRIVATE_KEY + Base gas.
  if (splitCfg.enabled) {
    const opKey = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
    if (opKey) {
      void forwardNetToVault({
        amountSmallest: BigInt(pricing.perCallSmallest),
        vault: vaultRecipient,
        sliceBps: splitCfg.sliceBps,
        usdc: x402Net.base.usdc,
        rpcUrl: x402Net.base.rpcUrl,
        operatorKey: opKey,
      }).catch((e) => console.error("[self-fund] net forward to vault failed:", (e as Error).message));
    } else {
      console.error("[self-fund] split enabled but OPERATOR_PRIVATE_KEY unset — net not forwarded");
    }
  }

  const callId = crypto.randomUUID();
  const subscriber = body.subscriber;

  // Kick the runtime off in the BACKGROUND; return immediately with the callId
  // plus the settlement response header. Client polls /x402/calls/:callId.
  inFlight.set(callId, {
    status: "running",
    tokenId: tokenId.toString(),
    subscriber,
    startedAt: Date.now(),
  });
  pruneInFlight();

  void runInferenceAsync({
    deps,
    callId,
    tokenId,
    subscriber,
    input: body.input,
    paymentReceiptId: settle.transaction || (gate.payer ?? "x402v2"),
  });

  return json(
    { ok: true, status: "running", callId, settlementTx: settle.transaction },
    { headers: { "PAYMENT-RESPONSE": settleResponseHeader(settle) } },
  );
}

interface AsyncInferArgs {
  deps: HttpDeps;
  callId: string;
  tokenId: bigint;
  subscriber: `0x${string}`;
  input: string;
  paymentReceiptId: string;
}

async function runInferenceAsync(args: AsyncInferArgs): Promise<void> {
  const { deps, callId, tokenId, subscriber, input, paymentReceiptId } = args;
  try {
    // Onchain authorizeUsage grant in parallel with the agent task.
    const grantPromise = grantUsage(deps, tokenId, subscriber);
    const runtime = await deps.runtimes.forToken(tokenId);
    await runtime.load({ tokenId });
    const taskOutput = await runtime.runTask({
      tokenId,
      subscriber,
      input,
      paymentReceiptId,
    });
    const inferenceReceipt = await deps.receiptSigner.build(
      runtime.kind,
      taskOutput,
      { tokenId, subscriber, paymentReceiptId },
      callId,
    );
    recordReceipt(inferenceReceipt);
    const grantTx = await grantPromise;
    // Compact the transcript into UI-safe steps (drop raw content; keep the
    // tool name + its short summary, which is where peer-payment lines live).
    const steps = (taskOutput.transcript ?? []).map((s) => {
      if (s.kind === "tool") return { kind: "tool", tool: s.tool, summary: s.resultSummary };
      if (s.kind === "llm") return { kind: "llm", summary: `${s.model}` };
      if (s.kind === "skill_create") return { kind: "skill", summary: `learned skill: ${s.skill}` };
      if (s.kind === "memory_write") return { kind: "memory", summary: `noted: ${s.key}` };
      return { kind: s.kind, summary: "" };
    });
    inFlight.set(callId, {
      status: "complete",
      output: taskOutput.output,
      receipt: inferenceReceipt,
      callId,
      authorizeUsageTx: grantTx,
      steps,
      completedAt: Date.now(),
    });
  } catch (err) {
    const msg =
      err instanceof RuntimeError
        ? `agent runtime unavailable: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`[x402/infer] callId=${callId} failed: ${msg.slice(0, 250)}`);
    inFlight.set(callId, {
      status: "error",
      message: msg,
      completedAt: Date.now(),
    });
  }
}

function handleInferResult(callId: string): Response {
  pruneInFlight();
  const state = inFlight.get(callId);
  if (!state) {
    return json({ status: "not-found" }, { status: 404 });
  }
  if (state.status === "running") {
    return json({ status: "running", callId, sinceMs: Date.now() - state.startedAt });
  }
  if (state.status === "error") {
    return json({ status: "error", message: state.message }, { status: 500 });
  }
  return json({
    ok: true,
    status: "complete",
    callId: state.callId,
    output: state.output,
    receipt: state.receipt,
    authorizeUsageTx: state.authorizeUsageTx,
    steps: state.steps,
  });
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
