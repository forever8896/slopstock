/**
 * Drill-Cypher step 4 — end-to-end orchestration.
 *
 *   generateDrillLyrics (0G TEE)  →  generateAudio (ElevenLabs, key via 1Claw)
 *                                 →  storeTrack (Walrus)  →  DrillResult
 *
 * All three stages are injectable so the orchestration is unit-testable without
 * 0G / ElevenLabs / Walrus. In production the audio stage's credential is
 * resolved through 1Claw (`resolveSecret('elevenlabs', { tokenId })`) — the key
 * never enters the model context or the receipt.
 */

import type { OperatorConfig } from "../../config.ts";
import { resolveSecret } from "../../store/secrets.ts";
import { generateDrillLyrics, type DrillInput, type DrillLyrics } from "./generate-lyrics.ts";
import { generateAudio } from "./tools.ts";
import { storeTrack, type TrackReceipt } from "./store-audio.ts";

/** The credential reference + agent identity the drill-cypher tool resolves. */
export const DRILL_CYPHER_SECRET_REF = "elevenlabs";
export const DRILL_CYPHER_TOKEN_ID = 4n; // drill-cypher agent's tokenId (per-agent secret scope)

export interface DrillResult {
  lyrics: string;
  stylePrompt: string;
  blobId: string;
  aggregatorUrl: string;
  bars: number;
  alreadyCertified: boolean;
}

export interface RunDrillDeps {
  tokenId?: bigint;
  config?: OperatorConfig;
  /** Resolve the ElevenLabs key (defaults to 1Claw via resolveSecret). */
  resolveKey?: () => Promise<string>;
  generateLyrics?: (input: DrillInput) => Promise<DrillLyrics>;
  generateAudio?: (lyrics: string, stylePrompt: string, resolveKey: () => Promise<string>) => Promise<Uint8Array>;
  storeTrack?: (audio: Uint8Array, meta: { title: string; style: string }) => Promise<TrackReceipt>;
}

export async function runDrillCypher(input: DrillInput, deps: RunDrillDeps = {}): Promise<DrillResult> {
  const tokenId = deps.tokenId ?? DRILL_CYPHER_TOKEN_ID;

  // Credential resolver bound to this agent — 1Claw in prod, injected in tests.
  const resolveKey =
    deps.resolveKey ??
    (() => {
      if (!deps.config) throw new Error("drill-cypher: config required to resolve the ElevenLabs credential via 1Claw");
      return resolveSecret(DRILL_CYPHER_SECRET_REF, { tokenId, config: deps.config });
    });

  const genLyrics = deps.generateLyrics ?? ((i: DrillInput) => generateDrillLyrics(i));
  const genAudio =
    deps.generateAudio ??
    ((lyrics: string, stylePrompt: string, rk: () => Promise<string>) =>
      generateAudio(lyrics, stylePrompt, { resolveKey: rk }));
  const store = deps.storeTrack ?? ((audio, meta) => storeTrack(audio, meta));

  // 1. Lyrics on 0G (no credential in context).
  const lyrics = await genLyrics(input);

  // 2. Produced track from ElevenLabs — key resolved just-in-time via 1Claw.
  const audio = await genAudio(lyrics.lyrics, lyrics.stylePrompt, resolveKey);

  // 3. Pin to Walrus; return a browser-playable public URL.
  const track = await store(audio, { title: `drill-cypher ${input.opps.join(", ")}`, style: input.style ?? "ny-drill" });

  return {
    lyrics: lyrics.lyrics,
    stylePrompt: lyrics.stylePrompt,
    blobId: track.blobId,
    aggregatorUrl: track.aggregatorUrl,
    bars: lyrics.bars,
    alreadyCertified: track.alreadyCertified,
  };
}
