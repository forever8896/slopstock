/**
 * Drill-Cypher step 2 — ElevenLabs Music v2 audio generation tool.
 *
 * The credential is the centerpiece of the design: the ElevenLabs key is NOT in
 * env or in the model context. It is resolved just-in-time via `resolveKey`
 * (bound to `resolveSecret('elevenlabs', { tokenId })` → 1Claw HSM) and used
 * only for the outbound POST. The key never enters the model prompt, the
 * receipt transcript, or any error message (leak guard, asserted in tests).
 *
 * NOTE: the exact Music v2 endpoint + request body are pinned by plan 11's
 * Step-0 de-risk gate (one real call). Until an ElevenLabs key exists they are
 * the documented best-guess and are trivially adjustable here without touching
 * callers. ENDPOINT + buildRequestBody are the two knobs the gate confirms.
 */

/** ElevenLabs Music v2 endpoint (confirm exact path at the Step-0 de-risk gate). */
export const ELEVENLABS_MUSIC_ENDPOINT = "https://api.elevenlabs.io/v1/music";

export interface GenerateAudioDeps {
  /** Resolves the ElevenLabs API key just-in-time (1Claw in prod, fake in tests). */
  resolveKey: () => Promise<string>;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override the endpoint (de-risk gate / alternate provider). */
  endpoint?: string;
  /** Target track length in ms (default 30s). */
  musicLengthMs?: number;
}

/** The request body for Music v2. Isolated so the de-risk gate can correct the
 *  shape in one place. */
export function buildRequestBody(lyrics: string, stylePrompt: string, musicLengthMs: number): string {
  return JSON.stringify({
    prompt: stylePrompt,
    lyrics,
    music_length_ms: musicLengthMs,
    output_format: "mp3_44100_128",
  });
}

/**
 * Generate a produced track from lyrics + a style prompt. Returns raw MP3 bytes.
 * Throws a descriptive (key-free) error on credential-resolution failure or a
 * non-2xx ElevenLabs response.
 */
export async function generateAudio(
  lyrics: string,
  stylePrompt: string,
  deps: GenerateAudioDeps,
): Promise<Uint8Array> {
  // 1. Resolve the credential at the tool layer, immediately before use.
  let apiKey: string;
  try {
    apiKey = await deps.resolveKey();
  } catch (err) {
    // Surface the resolver's own message (e.g. "1Claw not configured") — never
    // a cryptic network error — but it carries no secret value.
    throw new Error(`could not resolve ElevenLabs credential: ${(err as Error).message}`);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const endpoint = deps.endpoint ?? ELEVENLABS_MUSIC_ENDPOINT;
  const body = buildRequestBody(lyrics, stylePrompt, deps.musicLengthMs ?? 30_000);

  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    throw new Error(`ElevenLabs request failed: ${(err as Error).message}`); // no key
  }

  if (!res.ok) {
    // Read a short body snippet for diagnostics, but never echo the key.
    const snippet = (await res.text().catch(() => "")).slice(0, 160);
    throw new Error(`ElevenLabs error: ${res.status} ${snippet}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}
