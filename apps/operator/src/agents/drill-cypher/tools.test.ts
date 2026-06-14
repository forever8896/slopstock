import { test, expect } from "bun:test";
import { generateAudio, ELEVENLABS_MUSIC_ENDPOINT } from "./tools.ts";

const KEY = "sk_elevenlabs_LIVE_DO_NOT_LEAK_99";
const MP3 = new Uint8Array(20_000).fill(7); // pretend MP3 bytes

function mockFetch(status: number, body: BodyInit): { fn: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("generateAudio resolves the key via the injected resolver and sends it as xi-api-key", async () => {
  const { fn, calls } = mockFetch(200, MP3);
  let resolverCalled = 0;
  const audio = await generateAudio("bar one\nbar two", "dark ny drill 140bpm", {
    resolveKey: async () => { resolverCalled++; return KEY; },
    fetchImpl: fn,
  });
  expect(audio.length).toBe(MP3.length);
  expect(resolverCalled).toBe(1);
  expect(calls[0]!.url).toBe(ELEVENLABS_MUSIC_ENDPOINT);
  expect((calls[0]!.init!.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
});

test("LEAK GUARD: a 4xx from ElevenLabs throws a descriptive error WITHOUT the key", async () => {
  const { fn } = mockFetch(401, JSON.stringify({ detail: "bad key" }));
  const err = (await generateAudio("x", "y", { resolveKey: async () => KEY, fetchImpl: fn }).catch((e) => e)) as Error;
  expect(err.message).toContain("ElevenLabs");
  expect(err.message).toContain("401");
  expect(err.message.includes(KEY)).toBe(false);
});

test("a credential-resolution failure surfaces clearly (not a cryptic network error)", async () => {
  const { fn } = mockFetch(200, MP3);
  const err = (await generateAudio("x", "y", {
    resolveKey: async () => { throw new Error("1Claw not configured"); },
    fetchImpl: fn,
  }).catch((e) => e)) as Error;
  expect(err.message).toContain("1Claw not configured");
});
