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

import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

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
    //    Use the OpenAI SDK rather than Bun's raw fetch because the SDK
    //    routes through Node's http(s) module which honors
    //    NODE_TLS_REJECT_UNAUTHORIZED — needed for 0G testnet providers
    //    that serve over non-public-CA HTTPS.
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      baseURL: (meta.endpoint as string).replace(/\/+$/, ""),
      apiKey: "not-used",
    });

    let completion;
    try {
      completion = await client.chat.completions.create(
        {
          model: meta.model as string,
          messages: req.messages.filter((m) => m.role !== "tool") as never,
          temperature: req.temperature ?? 0.1,
          stream: false,
        },
        { headers: headers as unknown as Record<string, string> },
      );
    } catch (err) {
      throw new BackendError(
        `0G compute provider unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new BackendError("0G provider returned empty content");
    const chatId = completion.id ?? "";
    const json = {
      model: completion.model,
      usage: {
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
      },
    };

    // 4. Verify the signed response.
    // SDK fetches the signature from chatId and verifies. We try several
    // call shapes since the SDK's TS signature and JSDoc disagree on arg
    // order, and the version we have may want a different shape.
    let isValid = false;
    const attempts: Array<[string, () => Promise<boolean | null>]> = [
      ["(provider, chatId)", () => broker.inference.processResponse(providerAddress, chatId)],
      ["(provider, content)", () => broker.inference.processResponse(providerAddress, content)],
      ["(provider, chatId, content)", () => broker.inference.processResponse(providerAddress, chatId, content)],
      ["(provider, content, chatId)", () => broker.inference.processResponse(providerAddress, content, chatId)],
    ];
    for (const [label, fn] of attempts) {
      try {
        const r = await fn();
        console.log(`[0g-compute] processResponse ${label} → ${r}`);
        if (r === true) {
          isValid = true;
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[0g-compute] processResponse ${label} threw: ${msg.slice(0, 200)}`);
      }
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
 * Helper: lazy broker singleton. We don't want to spin one up unless a
 * 0G-routed agent actually fires its first task.
 */
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import type { OperatorConfig } from "../config.ts";

let _brokerPromise: Promise<ZGComputeNetworkBroker> | null = null;

export function getZGBroker(config: OperatorConfig): Promise<ZGComputeNetworkBroker> {
  if (_brokerPromise) return _brokerPromise;
  _brokerPromise = (async () => {
    const provider = new ethers.JsonRpcProvider(config.ZG_RPC_URL);
    const wallet = new ethers.Wallet(config.OPERATOR_PRIVATE_KEY, provider);
    return createZGComputeNetworkBroker(wallet);
  })();
  return _brokerPromise;
}
