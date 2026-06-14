/**
 * Live e2e smoke for the drill-cypher pipeline + the two load-bearing capabilities.
 *
 *   real 0G lyrics  →  real 1Claw key resolution  →  (mocked ElevenLabs*)  →
 *   real Walrus store  →  real Walrus read-back (retrieval proof)
 *
 * *No ElevenLabs key exists yet (Step-0 de-risk gate pending), so the audio
 *  call's fetch is mocked to return dummy MP3 bytes — BUT the credential is
 *  still resolved live from 1Claw, proving the wiring. Everything else is real.
 *
 *   set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-drill-cypher.ts
 */

import { loadConfig } from "../src/config.ts";
import { provisionSecret, resolveSecret, getOneClawClient, secretPath } from "../src/store/secrets.ts";
import { generateDrillLyrics } from "../src/agents/drill-cypher/generate-lyrics.ts";
import { generateAudio } from "../src/agents/drill-cypher/tools.ts";
import { storeTrack } from "../src/agents/drill-cypher/store-audio.ts";
import { runDrillCypher, DRILL_CYPHER_TOKEN_ID, DRILL_CYPHER_SECRET_REF } from "../src/agents/drill-cypher/run.ts";
import { WalrusClient } from "../src/storage/walrus-client.ts";

const config = loadConfig();
const DUMMY_KEY = "sk_eleven_DEMO_placeholder_until_real_key";

// 1. Provision a placeholder ElevenLabs key into 1Claw at the agent's path.
console.log("① provisioning placeholder ElevenLabs key into 1Claw (agent", DRILL_CYPHER_TOKEN_ID + ")…");
await provisionSecret(DRILL_CYPHER_SECRET_REF, DUMMY_KEY, { tokenId: DRILL_CYPHER_TOKEN_ID, config, service: "elevenlabs" });

// 2. Mocked ElevenLabs fetch — returns dummy MP3 bytes so we don't need a real
//    key, but the REAL generateAudio() + REAL 1Claw resolveKey still run.
const dummyMp3 = new Uint8Array(24_000);
dummyMp3.set([0x49, 0x44, 0x33]); // "ID3"
const mockEleven = (async () => new Response(dummyMp3, { status: 200 })) as unknown as typeof fetch;

const walrus = new WalrusClient();
let resolvedKeyOk = false;

console.log("② running drill-cypher (real 0G lyrics + real 1Claw resolve + real Walrus)…");
const result = await runDrillCypher(
  { opps: ["ORCL agent", "MEMER agent"], style: "ny-drill", extraBars: "they shipped a rug-pull token" },
  {
    config,
    tokenId: DRILL_CYPHER_TOKEN_ID,
    generateLyrics: (i) => generateDrillLyrics(i), // REAL 0G
    resolveKey: async () => {
      const k = await resolveSecret(DRILL_CYPHER_SECRET_REF, { tokenId: DRILL_CYPHER_TOKEN_ID, config }); // REAL 1Claw
      resolvedKeyOk = k === DUMMY_KEY;
      return k;
    },
    generateAudio: (lyrics, style, resolveKey) =>
      generateAudio(lyrics, style, { resolveKey, fetchImpl: mockEleven }), // REAL tool, mocked HTTP
    storeTrack: (audio, meta) => storeTrack(audio, meta, { client: walrus, epochs: 5 }), // REAL Walrus
  },
);

console.log("\n──── LYRICS (0G deepseek-v3) ────");
console.log(result.lyrics);
console.log("\n──── RESULT ────");
console.log("bars:", result.bars, "| stylePrompt:", result.stylePrompt);
console.log("1Claw key resolved live:", resolvedKeyOk ? "✅" : "❌");
console.log("Walrus blobId:", result.blobId);
console.log("Walrus URL:", result.aggregatorUrl);

// 3. Prove RETRIEVAL: read the blob back from the public aggregator.
console.log("\n③ reading the track back from Walrus (retrieval proof)…");
const readBack = await walrus.read(result.blobId);
const retrievalOk = readBack.length === dummyMp3.length;
console.log("retrieved", readBack.length, "bytes:", retrievalOk ? "✅ matches stored size" : "❌ mismatch");

// 4. Cleanup the placeholder secret.
await getOneClawClient(config).deleteSecret(secretPath(DRILL_CYPHER_TOKEN_ID, DRILL_CYPHER_SECRET_REF));
console.log("④ cleaned up placeholder 1Claw secret");

const allOk = resolvedKeyOk && retrievalOk && result.bars >= 8 && result.blobId.length > 0;
console.log(allOk ? "\n✅ DRILL-CYPHER PIPELINE FUNCTIONS LIVE (0G + 1Claw + Walrus store/retrieve)." : "\n❌ something didn't line up");
if (!allOk) process.exit(1);
