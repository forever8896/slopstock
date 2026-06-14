import { test, expect } from "bun:test";
import {
  secretPath,
  resolveSecret,
  SecretNotConfiguredError,
  type SecretSource,
} from "./secrets.ts";
import type { OperatorConfig } from "../config.ts";

const SECRET_VALUE = "sk_live_ELEVENLABS_DO_NOT_LEAK";

/** Minimal config stub for the resolver. */
function cfg(over: Partial<OperatorConfig> = {}): OperatorConfig {
  return { ONECLAW_BASE_URL: "https://api.1claw.xyz", ...over } as OperatorConfig;
}

/** Fake secret source so the resolver test needs no network. */
function fakeSource(map: Record<string, string>): SecretSource {
  return {
    getSecret: async (path: string) => {
      const value = map[path];
      if (value == null) throw new Error(`not found: ${path}`);
      return { path, value, version: 1 };
    },
  };
}

test("secretPath is scoped per agent: agents/<tokenId>/<secretRef>", () => {
  expect(secretPath(7n, "elevenlabs")).toBe("agents/7/elevenlabs");
  expect(secretPath(42n, "openai")).toBe("agents/42/openai");
});

test("resolveSecret fetches the per-agent secret value via the source", async () => {
  const source = fakeSource({ "agents/7/elevenlabs": SECRET_VALUE });
  const value = await resolveSecret("elevenlabs", { tokenId: 7n, config: cfg(), source });
  expect(value).toBe(SECRET_VALUE);
});

test("resolveSecret throws SecretNotConfiguredError when 1Claw isn't configured", async () => {
  // No ONECLAW_API_KEY and no injected source → cannot resolve.
  const err = await resolveSecret("elevenlabs", { tokenId: 7n, config: cfg() }).catch((e) => e);
  expect(err).toBeInstanceOf(SecretNotConfiguredError);
});

test("a resolution failure error never contains the secret value", async () => {
  const source = fakeSource({ "agents/7/elevenlabs": SECRET_VALUE });
  // Ask for a ref that isn't present → source throws; resolver must not leak.
  const err = (await resolveSecret("missing", { tokenId: 7n, config: cfg(), source }).catch((e) => e)) as Error;
  expect(err.message.includes(SECRET_VALUE)).toBe(false);
});
