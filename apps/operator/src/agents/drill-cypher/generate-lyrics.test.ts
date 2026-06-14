import { test, expect } from "bun:test";
import { buildPrompts, parseLyricsResponse, generateDrillLyrics } from "./generate-lyrics.ts";

const FAKE_JSON = JSON.stringify({
  lyrics: "ORCL agent claimin' oracle, data soft like a marshmallow (grrah)\nMEMER droppin' jpegs, no bag, that's a hard no\nThird bar bounce, watch me punch in on the one\nFourth bar pull back, opps done before they begun\nFifth, sixth, scammin' with a rug, we don't gamble\nSeventh bar cold, leave your whole stack in a shambles\nEighth bar land it, slopstock runnin' up the ledger\nNinth bar, no cap, every one of you a debtor",
  style_prompt: "bouncy NY drill 140bpm gritty 808 ad-libs",
});

test("buildPrompts injects the opps and the requested style into the user prompt", () => {
  const { system, user } = buildPrompts({ opps: ["ORCL agent", "MEMER agent"], style: "ny-drill" });
  expect(system).toContain("DRILL-CYPHER");
  expect(user).toContain("ORCL agent");
  expect(user).toContain("MEMER agent");
  expect(user.toLowerCase()).toContain("ny-drill");
});

test("parseLyricsResponse parses JSON and counts bars; tolerates ```json fences", () => {
  const fenced = "```json\n" + FAKE_JSON + "\n```";
  const r = parseLyricsResponse(fenced);
  expect(r.stylePrompt).toBe("bouncy NY drill 140bpm gritty 808 ad-libs");
  expect(r.bars).toBeGreaterThanOrEqual(8);
  expect(r.lyrics).toContain("ORCL");
});

test("parseLyricsResponse counts ' / '-separated bars, not just newlines", () => {
  // Models often write 4 bars per line separated by slashes (real 0G output shape).
  const json = JSON.stringify({
    lyrics: "bar one / bar two / bar three / bar four\nbar five / bar six / bar seven / bar eight",
    style_prompt: "ny drill 140",
  });
  expect(parseLyricsResponse(json).bars).toBe(8);
});

test("generateDrillLyrics returns structured lyrics using the injected inference fn", async () => {
  const r = await generateDrillLyrics(
    { opps: ["ORCL agent"], style: "ny-drill" },
    { infer: async () => FAKE_JSON },
  );
  expect(r.lyrics).toContain("ORCL");
  expect(r.bars).toBeGreaterThanOrEqual(8);
  expect(r.stylePrompt.length).toBeGreaterThan(0);
  expect(r.stylePrompt.length).toBeLessThan(200);
});

test("the inference call receives NO ElevenLabs/credential material (key isolation)", async () => {
  let seen = "";
  await generateDrillLyrics(
    { opps: ["AUDIT"], style: "uk-drill" },
    { infer: async (system, user) => { seen = system + user; return FAKE_JSON; } },
  );
  // The lyrics model only ever sees drill craft + opps — never any api key.
  expect(seen.toLowerCase()).not.toContain("xi-api-key");
  expect(seen).not.toContain("sk_");
});
