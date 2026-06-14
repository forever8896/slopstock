import { test, expect } from "bun:test";
import { OneClawClient, OneClawError } from "./oneclaw.ts";

/** Build a mock fetch that records calls and replays canned responses. */
function mockFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
): { fn: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const SECRET_VALUE = "sk_live_SUPER_SECRET_DO_NOT_LEAK_42";

test("1ck_ key is used directly as a Bearer token (no auth-token exchange)", async () => {
  const { fn, calls } = mockFetch(() => ({
    status: 200,
    body: { path: "agents/1/x", value: SECRET_VALUE, version: 1 },
  }));
  const c = new OneClawClient({ apiKey: "1ck_abc", vaultId: "v1", fetchImpl: fn });
  await c.getSecret("agents/1/x");
  // No call to /v1/auth/agent-token; the GET carries the 1ck_ key as Bearer.
  expect(calls.some((c) => c.url.includes("/v1/auth/agent-token"))).toBe(false);
  const auth = (calls[0]!.init!.headers as Record<string, string>)["Authorization"];
  expect(auth).toBe("Bearer 1ck_abc");
});

test("ocv_ key is exchanged for a short-lived JWT, then cached", async () => {
  let tokenCalls = 0;
  const { fn } = mockFetch((url) => {
    if (url.includes("/v1/auth/agent-token")) {
      tokenCalls++;
      return { status: 200, body: { access_token: "jwt_xyz", expires_in: 900, vault_ids: ["v1"] } };
    }
    return { status: 200, body: { path: "agents/1/x", value: SECRET_VALUE, version: 1 } };
  });
  const c = new OneClawClient({ apiKey: "ocv_abc", vaultId: "v1", fetchImpl: fn });
  await c.getSecret("agents/1/x");
  await c.getSecret("agents/1/x");
  expect(tokenCalls).toBe(1); // JWT cached across calls
});

test("getSecret returns the value + version from the vault", async () => {
  const { fn, calls } = mockFetch(() => ({
    status: 200,
    body: { id: "s1", path: "agents/7/elevenlabs", type: "api_key", value: SECRET_VALUE, version: 3 },
  }));
  const c = new OneClawClient({ apiKey: "1ck_abc", vaultId: "vault-7", fetchImpl: fn });
  const s = await c.getSecret("agents/7/elevenlabs");
  expect(s.value).toBe(SECRET_VALUE);
  expect(s.version).toBe(3);
  expect(calls[0]!.url).toBe("https://api.1claw.xyz/v1/vaults/vault-7/secrets/agents/7/elevenlabs");
  expect((calls[0]!.init!.method ?? "GET")).toBe("GET");
});

test("putSecret PUTs value+type+metadata to the secret path", async () => {
  const { fn, calls } = mockFetch(() => ({
    status: 201,
    body: { id: "s1", path: "agents/7/elevenlabs", type: "api_key", version: 1 },
  }));
  const c = new OneClawClient({ apiKey: "1ck_abc", vaultId: "vault-7", fetchImpl: fn });
  await c.putSecret("agents/7/elevenlabs", SECRET_VALUE, {
    type: "api_key",
    metadata: { service: "elevenlabs" },
  });
  expect(calls[0]!.init!.method).toBe("PUT");
  const sent = JSON.parse(calls[0]!.init!.body as string);
  expect(sent.value).toBe(SECRET_VALUE);
  expect(sent.type).toBe("api_key");
  expect(sent.metadata.service).toBe("elevenlabs");
});

test("a non-ok response throws OneClawError with the status code", async () => {
  const { fn } = mockFetch(() => ({ status: 404, body: { title: "Not Found" } }));
  const c = new OneClawClient({ apiKey: "1ck_abc", vaultId: "v1", fetchImpl: fn });
  const err = await c.getSecret("agents/1/missing").catch((e) => e);
  expect(err).toBeInstanceOf(OneClawError);
  expect((err as OneClawError).status).toBe(404);
});

test("LEAK GUARD: a failed putSecret never includes the secret value in the error", async () => {
  const { fn } = mockFetch(() => ({ status: 500, body: { title: "boom" } }));
  const c = new OneClawClient({ apiKey: "1ck_abc", vaultId: "v1", fetchImpl: fn });
  const err = (await c.putSecret("agents/1/x", SECRET_VALUE, { type: "api_key" }).catch((e) => e)) as Error;
  expect(err.message.includes(SECRET_VALUE)).toBe(false);
  expect(JSON.stringify(err).includes(SECRET_VALUE)).toBe(false);
});
