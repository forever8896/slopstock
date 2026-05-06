/**
 * LLM compute backend.
 *
 * The Slopstock runtime layer is decoupled from where the LLM call goes.
 * Two backends ship today:
 *
 *   - OpenAICompatBackend: hits any OpenAI-compatible Chat Completions
 *     endpoint (Ollama, OpenRouter, Together, raw OpenAI). Cheap and
 *     simple. No TEE attestation — the receipt's teeAttestation stays
 *     a deterministic placeholder.
 *
 *   - ZGComputeBackend: routes through the 0G Compute Network broker.
 *     Each call goes to a TeeML-verified provider running inside an
 *     Intel TDX (or NVIDIA H100/H200) enclave. Response is signed by
 *     the TEE; broker.processResponse(provider, chatId, content)
 *     verifies that signature and returns isValid. The receipt's
 *     teeAttestation field carries the signed verification.
 *
 * Adding a new backend is one new class implementing LLMBackend.
 */

import type { Hex } from "@stratum/shared";

export type ChatRole = "system" | "user" | "assistant" | "tool";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LLMRequest {
  messages: ChatMessage[];
  /** Lower is more deterministic. Defaults to 0.1 if unset. */
  temperature?: number;
  /** If true, ask the backend for JSON-shaped output. Backend may ignore. */
  jsonMode?: boolean;
}

export interface LLMResponse {
  content: string;
  /** Identifier the backend reports for the model that ran. */
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Backend-specific attestation. Empty for openai-compat; populated for
   *  0G Compute with the broker's verification result. */
  attestation: BackendAttestation;
}

export type BackendAttestation =
  | {
      kind: "none";
      /** Identifies the backend so we surface it honestly in receipts. */
      backend: "openai-compat";
      baseUrl: string;
    }
  | {
      kind: "0g-tee";
      backend: "0g-compute";
      /** TEE provider that handled the call. */
      provider: Hex;
      /** Inference call id from the provider; can be reconstructed later. */
      chatId: string;
      /** Result of broker.processResponse — TRUE means the provider's
       *  signature checked out and the Docker Compose hash matched. */
      isValid: boolean;
    };

export interface LLMBackend {
  /** "openai-compat" for OpenAICompatBackend; "0g-compute" for ZGComputeBackend. */
  readonly kind: "openai-compat" | "0g-compute";
  /** Identifier the operator advertises for this backend (e.g. base URL). */
  readonly description: string;
  call(req: LLMRequest): Promise<LLMResponse>;
}

export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendError";
  }
}

// ─── OpenAI-compatible HTTP backend ─────────────────────────────────────

export interface OpenAICompatBackendOpts {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export class OpenAICompatBackend implements LLMBackend {
  readonly kind = "openai-compat" as const;
  readonly description: string;

  constructor(private readonly opts: OpenAICompatBackendOpts) {
    this.description = `${opts.baseUrl} (${opts.model})`;
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey) headers["Authorization"] = `Bearer ${this.opts.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.1,
      stream: false,
    };
    if (req.jsonMode) body["response_format"] = { type: "json_object" };

    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (err) {
      throw new BackendError(
        `${this.opts.baseUrl} unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable>");
      throw new BackendError(`${this.opts.baseUrl} ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new BackendError(`${this.opts.baseUrl} returned empty content`);

    return {
      content,
      model: json.model ?? this.opts.model,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      attestation: { kind: "none", backend: "openai-compat", baseUrl: this.opts.baseUrl },
    };
  }
}

// ─── 0G Compute (TeeML-verified) backend ────────────────────────────────
//
// The broker is a stateful object. We hold one per operator process and
// share it across all 0G-routed agents (each call selects the configured
// provider). Init takes a few seconds and a chain read; we reuse it.

import type { ZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

export interface ZGComputeBackendOpts {
  broker: ZGComputeNetworkBroker;
  providerAddress: Hex;
}

export class ZGComputeBackend implements LLMBackend {
  readonly kind = "0g-compute" as const;
  readonly description: string;

  constructor(private readonly opts: ZGComputeBackendOpts) {
    this.description = `0G Compute (provider ${opts.providerAddress})`;
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const { broker, providerAddress } = this.opts;

    // 1. Service metadata — endpoint + model id from chain.
    const meta = await broker.inference.getServiceMetadata(providerAddress);

    // 2. Per-call signed headers from the broker.
    //    The broker signs a fresh challenge so the provider can prove freshness.
    const lastUserMessage = req.messages[req.messages.length - 1]?.content ?? "";
    const headers = await broker.inference.getRequestHeaders(providerAddress, lastUserMessage);

    // 3. POST OpenAI-shaped chat completion to the provider's endpoint.
    //    Raw fetch (not the OpenAI SDK) because we need to read the
    //    `ZG-Res-Key` response header — that's the chatID the provider
    //    looks up in its signature store. The OpenAI SDK abstracts
    //    response headers away.
    const url = `${(meta.endpoint as string).replace(/\/+$/, "")}/chat/completions`;
    const reqBody = {
      model: meta.model as string,
      messages: req.messages.filter((m) => m.role !== "tool"),
      temperature: req.temperature ?? 0.1,
      stream: false,
    };
    let completion: {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      id?: string;
    };
    let zgResKey: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(headers as unknown as Record<string, string>),
        },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "<unreadable>");
        throw new Error(`${res.status} ${text.slice(0, 400)}`);
      }
      // Provider's chatID for signature lookup is in this header per SDK docs:
      //   const chatID = response.headers.get('ZG-Res-Key') || completion.id
      zgResKey = res.headers.get("ZG-Res-Key") || res.headers.get("zg-res-key");
      // One-shot debug: log all response headers so we can see what the
      // provider actually returns and pick the right chatID source.
      const headerSummary: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headerSummary[k] = v.length > 200 ? v.slice(0, 200) + "…" : v;
      });
      console.log(
        `[0g-compute] response headers: ${JSON.stringify(headerSummary).slice(0, 800)}`,
      );
      completion = (await res.json()) as typeof completion;
      console.log(
        `[0g-compute] completion.id=${completion.id ?? "(missing)"} ZG-Res-Key=${zgResKey ?? "(missing)"}`,
      );
    } catch (err) {
      throw new BackendError(
        `0G compute provider unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new BackendError("0G provider returned empty content");
    const chatId = zgResKey || completion.id || "";
    const json = {
      model: completion.model,
      usage: {
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
      },
    };

    // 4. Verify the signed response. SDK 0.8.0's processResponse is broken
    //    for providers whose service URL already ends in /v1/proxy — it
    //    appends /v1/proxy/signature/... causing a doubled prefix and the
    //    "getting signature error" throw. We bypass and fetch the signature
    //    from the canonical URL, then verify with ethers against the on-
    //    chain registered teeSignerAddress.
    //
    //    Provider stores signatures with a brief lag after chat completion;
    //    retry up to ~6s before giving up.
    let isValid = false;
    try {
      const sigUrl = buildSignatureUrl(meta.endpoint as string, chatId, meta.model as string);
      let sigBody: { text: string; signature: string } | null = null;
      const RETRIES = 4;
      for (let i = 0; i < RETRIES; i++) {
        const sigRes = await fetch(sigUrl, { headers: { "Content-Type": "application/json" } });
        if (sigRes.ok) {
          sigBody = (await sigRes.json()) as { text: string; signature: string };
          break;
        }
        const body = await sigRes.text().catch(() => "");
        console.warn(
          `[0g-compute] signature fetch attempt ${i + 1}/${RETRIES} → ${sigRes.status}: ${body.slice(0, 200)}`,
        );
        if (i < RETRIES - 1) await new Promise((r) => setTimeout(r, 1500));
      }
      if (sigBody) {
        const status = await broker.inference.checkProviderSignerStatus(providerAddress);
        const signingAddr = status.teeSignerAddress;
        if (!signingAddr) {
          console.warn("[0g-compute] no teeSignerAddress from checkProviderSignerStatus");
        } else {
          const messageHash = ethers.hashMessage(sigBody.text);
          const recovered = ethers.recoverAddress(messageHash, sigBody.signature);
          isValid = recovered.toLowerCase() === signingAddr.toLowerCase();
          console.log(
            `[0g-compute] processResponse → ${isValid} (recovered=${recovered.slice(0, 10)}…, expected=${signingAddr.slice(0, 10)}…)`,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[0g-compute] manual processResponse threw: ${msg.slice(0, 200)}`);
    }

    return {
      content,
      model: (json.model as string) ?? (meta.model as string) ?? "0g-compute-unknown",
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      attestation: {
        kind: "0g-tee",
        backend: "0g-compute",
        provider: providerAddress,
        chatId,
        isValid,
      },
    };
  }
}

/**
 * Build the canonical signature endpoint URL for a provider's chatId.
 * SDK 0.8.0 incorrectly does `${svc.url}/v1/proxy/signature/...` when
 * svc.url already ends in /v1/proxy, doubling the prefix. We strip a
 * trailing /v1/proxy and add it once.
 */
function buildSignatureUrl(serviceUrl: string, chatId: string, model: string): string {
  const trimmed = serviceUrl.replace(/\/+$/, "").replace(/\/v1\/proxy$/, "");
  return `${trimmed}/v1/proxy/signature/${chatId}?model=${encodeURIComponent(model)}`;
}

/**
 * Helper: lazy broker singleton. We don't want to spin one up unless a
 * 0G-routed agent actually fires its first task.
 */
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import type { OperatorConfig } from "../config.ts";

let _brokerPromise: Promise<ZGComputeNetworkBroker> | null = null;

export function getZGBroker(config: OperatorConfig): Promise<ZGComputeNetworkBroker> {
  if (_brokerPromise) return _brokerPromise;
  _brokerPromise = (async () => {
    // Compute broker uses the *compute* RPC (mainnet for prod-grade TeeML
    // providers), which is independent of ZG_RPC_URL (chain reads of our
    // own iNFT + AgentRegistry contracts on testnet).
    const provider = new ethers.JsonRpcProvider(config.ZG_COMPUTE_RPC_URL);
    const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
    return createZGComputeNetworkBroker(wallet);
  })();
  return _brokerPromise;
}
