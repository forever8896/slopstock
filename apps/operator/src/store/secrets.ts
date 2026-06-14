/**
 * Per-agent credential resolver (plan 09). The one capability every agent in
 * the app uses to reach a credentialed service WITHOUT the secret ever entering
 * the LLM context, skill markdown, or receipt transcript.
 *
 *   - `resolveSecret(ref, { tokenId })`  → plaintext, fetched just-in-time from
 *     1Claw at the path `agents/<tokenId>/<ref>` (vault-scoped to this operator).
 *   - `provisionSecret(ref, value, …)`   → store a key once at launch.
 *
 * Backed by {@link OneClawClient}. A `SecretSource` seam keeps it unit-testable
 * (and lets future tiers — TEE-sealed, etc. — drop in) without changing callers.
 */

import type { OperatorConfig } from "../config.ts";
import { OneClawClient, type OneClawSecret } from "./oneclaw.ts";

/** The minimal read interface a credential backend must provide. */
export interface SecretSource {
  getSecret(path: string): Promise<OneClawSecret>;
}

/** Thrown when no credential backend is configured (no ONECLAW_API_KEY). */
export class SecretNotConfiguredError extends Error {
  constructor(message = "1Claw not configured (set ONECLAW_API_KEY + ONECLAW_VAULT_ID)") {
    super(message);
    this.name = "SecretNotConfiguredError";
  }
}

/** Vault path for an agent's secret. Scoped per tokenId so agents can't read
 *  each other's credentials when 1Claw policies enforce path prefixes. */
export function secretPath(tokenId: bigint, secretRef: string): string {
  return `agents/${tokenId}/${secretRef}`;
}

/** Process-wide 1Claw client, built lazily from config (one HSM connection). */
let _client: OneClawClient | null = null;
export function getOneClawClient(config: OperatorConfig, fetchImpl?: typeof fetch): OneClawClient {
  if (!config.ONECLAW_API_KEY || !config.ONECLAW_VAULT_ID) throw new SecretNotConfiguredError();
  if (!_client) {
    _client = new OneClawClient({
      apiKey: config.ONECLAW_API_KEY,
      baseUrl: config.ONECLAW_BASE_URL,
      vaultId: config.ONECLAW_VAULT_ID,
      fetchImpl,
    });
  }
  return _client;
}

/** For tests: drop the memoized client so the next call rebuilds from config. */
export function _resetOneClawClient(): void {
  _client = null;
}

export interface ResolveSecretOpts {
  tokenId: bigint;
  config: OperatorConfig;
  /** Inject a backend (tests / alternative tiers). Defaults to the 1Claw client. */
  source?: SecretSource;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the plaintext value of `secretRef` for the given agent. Call this
 * INSIDE the tool handler immediately before the outbound request — never
 * return the result to the model or write it to a receipt.
 */
export async function resolveSecret(secretRef: string, opts: ResolveSecretOpts): Promise<string> {
  const source = opts.source ?? getOneClawClient(opts.config, opts.fetchImpl);
  const path = secretPath(opts.tokenId, secretRef);
  try {
    const secret = await source.getSecret(path);
    return secret.value;
  } catch (err) {
    if (err instanceof SecretNotConfiguredError) throw err;
    // Re-wrap so nothing downstream can interpolate the (absent) value; the
    // ref/path are safe to surface, the value is not (and isn't present here).
    throw new Error(`failed to resolve secret "${secretRef}" (${path}): ${(err as Error).message}`);
  }
}

export interface ProvisionSecretOpts {
  tokenId: bigint;
  config: OperatorConfig;
  service?: string;
  fetchImpl?: typeof fetch;
}

/** Store an agent's credential into 1Claw once (e.g. at launch). The plaintext
 *  is taken here and never persisted in our DB / manifest / logs. */
export async function provisionSecret(secretRef: string, value: string, opts: ProvisionSecretOpts): Promise<{ path: string; version: number }> {
  const client = getOneClawClient(opts.config, opts.fetchImpl);
  return client.putSecret(secretPath(opts.tokenId, secretRef), value, {
    type: "api_key",
    metadata: { tokenId: String(opts.tokenId), secretRef, service: opts.service ?? secretRef },
  });
}
