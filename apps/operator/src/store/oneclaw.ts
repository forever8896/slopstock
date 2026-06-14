/**
 * 1Claw cloud-HSM secrets client (plan 09 Tier-2, https://docs.1claw.xyz).
 *
 * Agent credentials (e.g. the ElevenLabs key) live in 1Claw's HSM, not in our
 * DB / skill markdown / receipts. Tools fetch the plaintext *just-in-time* at
 * call time via `getSecret`, use it for the outbound request, and never return
 * it to the model or write it to the transcript.
 *
 * Verified contract (live, 2026-06-14):
 *   - `1ck_…` management keys  → used directly as `Authorization: Bearer 1ck_…`.
 *   - `ocv_…` agent keys       → POST /v1/auth/agent-token {api_key} →
 *                                { access_token, expires_in, vault_ids }; the
 *                                JWT is cached and refreshed before expiry.
 *   - PUT  /v1/vaults/:id/secrets/:path  {value,type,metadata}  → 201 (no value)
 *   - GET  /v1/vaults/:id/secrets/:path                          → {value,version,…}
 *   - DELETE /v1/vaults/:id/secrets/:path
 *   - GET  /v1/vaults                          → { vaults: [...] }
 *   - POST /v1/vaults  {name,description}       → { id, … }
 *
 * Secret values are NEVER placed into error messages or logs (leak guard).
 */

const DEFAULT_BASE_URL = "https://api.1claw.xyz";
/** Refresh the JWT this many ms before its stated expiry. */
const JWT_REFRESH_SKEW_MS = 30_000;

export interface OneClawSecret {
  id?: string;
  path: string;
  type?: string;
  value: string;
  version: number;
  metadata?: Record<string, unknown>;
}

export interface OneClawVault {
  id: string;
  name?: string;
  description?: string;
}

export interface PutSecretOpts {
  type?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
  maxAccessCount?: number;
}

export interface OneClawClientOpts {
  apiKey: string;
  baseUrl?: string;
  vaultId?: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Error that NEVER carries a secret value — safe to log/serialize. */
export class OneClawError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OneClawError";
    this.status = status;
  }
}

export class OneClawClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  readonly vaultId?: string;
  /** Cached JWT for ocv_ keys: the bearer string + absolute expiry epoch ms. */
  private jwt: { token: string; expMs: number } | null = null;

  constructor(opts: OneClawClientOpts) {
    if (!opts.apiKey) throw new OneClawError("1Claw apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.vaultId = opts.vaultId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** The Bearer token to send. 1ck_ keys pass through; ocv_ keys exchange+cache. */
  private async bearer(): Promise<string> {
    if (!this.apiKey.startsWith("ocv_")) return this.apiKey; // 1ck_ / other = direct
    const now = Date.now();
    if (this.jwt && this.jwt.expMs - JWT_REFRESH_SKEW_MS > now) return this.jwt.token;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/auth/agent-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey }),
    });
    if (!res.ok) throw new OneClawError(`agent-token exchange failed: ${res.status}`, res.status);
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    const ttlMs = (j.expires_in ?? 600) * 1000;
    this.jwt = { token: j.access_token, expMs: now + ttlMs };
    return j.access_token;
  }

  private async authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.bearer()}`, ...(extra ?? {}) };
  }

  private requireVault(vaultId?: string): string {
    const v = vaultId ?? this.vaultId;
    if (!v) throw new OneClawError("no vaultId configured (set ONECLAW_VAULT_ID)");
    return v;
  }

  /** Retrieve a secret's plaintext value. Just-in-time only. */
  async getSecret(path: string, vaultId?: string): Promise<OneClawSecret> {
    const v = this.requireVault(vaultId);
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/vaults/${v}/secrets/${path}`,
      { method: "GET", headers: await this.authHeaders() },
    );
    if (!res.ok) throw new OneClawError(`getSecret ${path} failed: ${res.status}`, res.status);
    return (await res.json()) as OneClawSecret;
  }

  /** Store/update a secret. The value is sent but NEVER echoed into errors. */
  async putSecret(path: string, value: string, opts: PutSecretOpts = {}, vaultId?: string): Promise<{ path: string; version: number }> {
    const v = this.requireVault(vaultId);
    const body: Record<string, unknown> = { value, type: opts.type ?? "api_key" };
    if (opts.metadata) body["metadata"] = opts.metadata;
    if (opts.expiresAt) body["expires_at"] = opts.expiresAt;
    if (opts.maxAccessCount != null) body["max_access_count"] = opts.maxAccessCount;
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/vaults/${v}/secrets/${path}`,
      { method: "PUT", headers: await this.authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) },
    );
    if (!res.ok) throw new OneClawError(`putSecret ${path} failed: ${res.status}`, res.status); // no value in message
    const j = (await res.json()) as { path: string; version: number };
    return { path: j.path, version: j.version };
  }

  /** Delete a secret (best-effort cleanup; used by tests + rotation). */
  async deleteSecret(path: string, vaultId?: string): Promise<void> {
    const v = this.requireVault(vaultId);
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/vaults/${v}/secrets/${path}`,
      { method: "DELETE", headers: await this.authHeaders() },
    );
    if (!res.ok && res.status !== 404) throw new OneClawError(`deleteSecret ${path} failed: ${res.status}`, res.status);
  }

  async listVaults(): Promise<OneClawVault[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/vaults`, { headers: await this.authHeaders() });
    if (!res.ok) throw new OneClawError(`listVaults failed: ${res.status}`, res.status);
    return ((await res.json()) as { vaults: OneClawVault[] }).vaults;
  }

  async createVault(name: string, description?: string): Promise<OneClawVault> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/vaults`, {
      method: "POST",
      headers: await this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) throw new OneClawError(`createVault failed: ${res.status}`, res.status);
    return (await res.json()) as OneClawVault;
  }
}
