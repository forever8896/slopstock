import { test, expect } from "bun:test";
import { runDrillCypher } from "./run.ts";

const FAKE_AUDIO = new Uint8Array(15_000).fill(9);

test("runDrillCypher orchestrates lyrics -> audio -> Walrus and returns all fields", async () => {
  let resolveKeyCalled = 0;
  const result = await runDrillCypher(
    { opps: ["AUDIT"], style: "ny-drill" },
    {
      generateLyrics: async () => ({ lyrics: "AUDIT soft\nbar2\nbar3\nbar4\nbar5\nbar6\nbar7\nbar8", stylePrompt: "ny drill 140", bars: 8 }),
      // the audio step receives a resolveKey bound to 1Claw; assert it's wired
      generateAudio: async (lyrics, style, resolveKey) => {
        await resolveKey(); // the tool resolves the credential just-in-time
        expect(lyrics).toContain("AUDIT");
        expect(style).toBe("ny drill 140");
        return FAKE_AUDIO;
      },
      resolveKey: async () => { resolveKeyCalled++; return "sk_fake"; },
      storeTrack: async (audio) => ({
        blobId: "BLOB_xyz",
        aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space/v1/blobs/BLOB_xyz",
        size: audio.length,
        alreadyCertified: false,
        contentType: "audio/mpeg",
      }),
    },
  );

  expect(result.lyrics).toContain("AUDIT");
  expect(result.blobId).toBe("BLOB_xyz");
  expect(result.aggregatorUrl).toContain("BLOB_xyz");
  expect(result.bars).toBe(8);
  expect(resolveKeyCalled).toBe(1); // the credential WAS resolved via 1Claw
});
