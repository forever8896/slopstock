# 11 — Drill-Cypher Agent (2nd consumer agent)

> **Why it matters at the venue:** virality is a distribution channel. A hacker who pays
> $2 USDC to get a drill track roasting their hackathon rivals and immediately plays it
> at their table is doing our GTM for us. The track stores on Walrus. The payment flows
> through x402. The model runs in a 0G TEE. It is Slopstock in one shot — absurd,
> auditable, and actually funny.
>
> Secondarily: ElevenLabs Music v2 is a genuine technical unlock (lyrics → full produced
> track in one API call, vocals on beat, commercially cleared). Storing that track on
> Walrus is a natural media bounty story on top of our existing skills bounty story
> ([03](03-walrus.md)).

## Why it's non-cosmetic

A drill-cypher agent that wraps a free LLM and calls `say` on a Mac is a toy. The
non-cosmetic requirements are:

1. **The audio is real, produced, and plays.** ElevenLabs Music v2 is not TTS layered
   over a beat — it is a single API call that turns lyrics + a style prompt into a full
   produced track (BPM, melody, mastering, vocal performance). The output is a playable
   MP3/WAV. This is qualitatively different from anything achievable at a hackathon three
   months ago.
2. **The lyrics are actually good drill.** Generic LLM output is mid. The system prompt
   carries curated drill craft knowledge: flow patterns (triplet-heavy 16s, pause on the
   two, "opps" placement), rhyme scheme conventions (AABB/ABAB in 16-bar blocks), UK vs.
   NY drill vocabulary differences, how to write bars that scan to a 140 BPM bounce. The
   model stays deepseek-v3 on 0G but the system prompt is the moat.
3. **The content latitude is proven.** Drill is an inherently edgy genre — profanity,
   aggressive language, taunting competitors are the idiom, not the exception. The 0G
   Compute TEE provider (`0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0`) was probed for
   this latitude in `apps/operator/scripts/smoke-0g-tone-test.ts`, which passes a system
   prompt that explicitly permits profanity. The model complied without refusal — confirmed.
4. **The track is stored on Walrus.** Every generated track gets pinned; the blobId goes
   back to the caller and appears in the platform tape. This is the media-storage bounty
   angle on top of the skills/memory storage story ([03](03-walrus.md)) — same client,
   different blob type, broader bounty case.
5. **The secret is not in the model context.** The ElevenLabs API key is injected at
   the tool layer (Tier-1 operator env per [09](09-agent-secrets.md)) — the model never
   sees it and it never enters the receipt/transcript.

## Architecture

```
caller (x402 HTTP)
  └─ POST /run/drill-cypher
       { opps: string[], style?: "uk-drill"|"ny-drill", extra_bars? }

operator
  ├─ 1. 0G Compute TEE inference  (deepseek-v3 @ 0x1B3AAef3…)
  │       system_prompt: <drill-craft knowledge block> + tone latitude grant
  │       user_prompt: "write a drill cypher roasting: <opps>"
  │       ── model returns: { lyrics: string, style_prompt: string }
  │             (structured JSON output; style_prompt is the ElevenLabs Music genre hint)
  │
  ├─ 2. ElevenLabs Music v2 call  (tool layer, key from ELEVENLABS_API_KEY env)
  │       POST https://api.elevenlabs.io/v1/sound-generation  (or music/generate endpoint)
  │       { text: lyrics, voice_settings: { style: style_prompt }, output_format: "mp3_44100_128" }
  │       ── returns: audio binary (MP3, ~30s)
  │
  └─ 3. Walrus store  (WalrusStorage from apps/operator/src/storage/walrus-client.ts)
          PUT blob → blobId
          ── returns: { blobId, aggregatorUrl, trackLength }
          ── receipt pinned with blobId (receipt chain)
```

### Brain: deepseek-v3 on 0G Compute

Same provider as demo-script agent (`0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0`,
deepseek-v3-0324). Upgrade to v4-pro is the same one-line provider swap once funded
([00](00-state-and-funding.md)).

The tone latitude test (`apps/operator/scripts/smoke-0g-tone-test.ts`) used system
prompt `"You are a no-bullshit hackathon hype writer. Profanity is encouraged when it
lands."` and the model produced compliant output without refusal. The drill-cypher system
prompt uses the same permission pattern, extended with genre framing.

### Inputs

| Field | Required | Notes |
|---|---|---|
| `opps` | ✅ yes | array of strings — names/handles/project names to roast |
| `style` | optional | `"uk-drill"` (darker, slower, menacing) vs `"ny-drill"` (bouncier, ad-libs). Default `"ny-drill"` |
| `extra_bars` | optional | free text — additional context ("they shipped a rug-pull token") |

### Moat: the drill-craft system prompt

The drill-craft knowledge block is the agent's IP. It encodes:
- Flow instruction: triplet-sixteenth delivery patterns, where to punch in and pull back,
  natural pause placement for UK vs. NY drill
- Rhyme scheme: 16-bar structure, AABB/ABAB hybrid, internal rhyme placement ("on the
  third syllable of bar two, mirror the last syllable of bar four")
- Vocabulary: authentic slang per style (UK: "opps", "ting", "Ps"; NY: "drills", "stains",
  "bag"), how to name-drop without being defamatory (handle-based, project-based, never
  doxxing)
- Scanability: bars must scan to approximately 140 BPM (NY) / 130 BPM (UK) — instruct
  the model to count syllables and mark stress
- Output format: structured JSON with `lyrics` (line-broken, with bar numbers) and
  `style_prompt` (a genre/mood phrase for ElevenLabs, e.g. "dark UK drill 130bpm minor
  key heavy 808")

### Moat: ElevenLabs Music v2 integration

ElevenLabs Music v2 is new enough that most hackathon projects haven't touched it. The
key capability: **lyrics + style → full track in one call**, no separate beat sourcing,
no TTS-over-instrumental alignment. The output is broadcast-quality (they claim
commercially cleared for non-commercial hackathon use). The API surface is small but
the integration is non-trivial:
- The lyrics must be formatted for the model (line-break sensitive, not prose).
- The style prompt is a craft decision, not just a genre tag.
- Audio output is streamed binary; we write it to a temp file, then push to Walrus.
- ElevenLabs has rate limits (check tier; Music v2 calls may be limited to ~5/min on
  free tier; **a paid key is required** — this is the Tier-1 secret).

**STOP-LOSS GATE (Tier-1 de-risk): before writing any production code, make ONE real
ElevenLabs Music v2 API call manually (curl or a 20-line script) with a sample lyric
and confirm: (a) the endpoint exists and accepts our format, (b) audio quality is
actually good enough to play at the venue, (c) the response time is under 60 s.**
If audio quality is bad or the endpoint is broken, the entire plan 11 is blocked — do
not build the wiring until this gate passes. Log the result in this doc.

### Secret management: Tier 1 (operator env)

Per [09](09-agent-secrets.md): `ELEVENLABS_API_KEY` lives in the operator's environment
/ Railway secret store. The tool handler injects it at call time:

```ts
// apps/operator/src/agents/drill-cypher/tools.ts
async function generateAudio(lyrics: string, stylePrompt: string): Promise<Buffer> {
  const apiKey = process.env["ELEVENLABS_API_KEY"]; // injected here, not by the LLM
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text: lyrics, voice_settings: { style: stylePrompt } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

The key is never passed to the 0G model, never in the system prompt, never in the
receipt transcript. The model's output is just text (lyrics + style_prompt JSON).

## Tech decisions (from research)

- **ElevenLabs Music v2 endpoint:** `POST https://api.elevenlabs.io/v1/sound-generation`
  (or the newer `music/generate` endpoint — **confirm which is live during the de-risk
  gate**). Output format: `mp3_44100_128` (44.1kHz, 128kbps, stereo) for venue playback.
- **Walrus blob type:** raw binary (MP3). Walrus is content-addressed regardless of type —
  the same `WalrusStorage.store(buffer)` method used for JSON manifests works for binary
  blobs. The aggregator serves the blob with whatever Content-Type we record; set
  `Content-Type: audio/mpeg` in the receipt metadata.
- **Track length target: 30–45 s.** Long enough to be satisfying at the venue; short
  enough to not overstay its welcome in a demo. The ElevenLabs `duration` param (if
  exposed) should target 30 s.
- **x402 pricing: 3.00 USDC per run.** COGS: ~$0.003 (0G inference) + ~$0.10 (ElevenLabs
  Music v2 API cost, rough estimate — **confirm from pricing page during de-risk**). The
  3 USDC price is aggressive but this is a party trick at a hackathon; keep it accessible.
- **Walrus epoch pinning: `epochs=90`** (same as other blobs in [03](03-walrus.md)).
  The track link stays alive for the weekend and then some.
- **No `read_file` tool needed.** Unlike the demo-script agent, there is no repo to
  read. The LLM call is a single non-agentic inference (no tool loop). Simpler.

## Build steps (TDD)

All tests in `apps/operator/src/agents/drill-cypher/`.

### Step 0 — de-risk gate (PREREQUISITE, do before any other step)

Run `apps/operator/scripts/smoke-elevenlabs-music.ts` (write this as the gate script):
- One real call to ElevenLabs Music v2 with a hardcoded 4-bar test lyric.
- Assert: response status 200, body is binary (not JSON error), byte length > 10000.
- Play the output file locally and confirm it sounds like music.
- Log result and ElevenLabs endpoint URL + response time in this doc under "De-risk result".

**Do not proceed to Step 1 until this gate passes.**

### Step 1 — drill lyric generation (0G inference)

`apps/operator/src/agents/drill-cypher/generate-lyrics.ts`

```ts
export async function generateDrillLyrics(input: DrillInput): Promise<DrillLyrics>
// DrillInput: { opps: string[], style: "uk-drill"|"ny-drill", extraBars?: string }
// DrillLyrics: { lyrics: string, stylePrompt: string, bars: number }
```

Tests (integration — real 0G mainnet):
- `generateDrillLyrics({ opps: ["MEMER agent", "ORCL agent"], style: "ny-drill" })`
  returns a string with `lyrics` and `stylePrompt` fields.
- Output `lyrics` contains at least one name from `opps`.
- Output `lyrics` has ≥ 8 distinct lines (≥ 8 bars).
- `stylePrompt` is non-empty and < 200 chars.
- With `style: "uk-drill"`, `stylePrompt` contains "UK" or "130" or "dark" (loose check
  that the model is applying the style knowledge; manual assertion acceptable).
- Call does NOT include any ElevenLabs credential in the 0G request headers (assert via
  request interceptor in test — the key must not leak to 0G).

### Step 2 — ElevenLabs audio generation tool

`apps/operator/src/agents/drill-cypher/tools.ts`

```ts
export async function generateAudio(lyrics: string, stylePrompt: string): Promise<Buffer>
```

Tests (require `ELEVENLABS_API_KEY` in env; skip with `test.skipIf(!process.env.ELEVENLABS_API_KEY)`):
- `generateAudio(sampleLyrics, "ny drill 140bpm")` returns a Buffer with `length > 10000`.
- Throws a descriptive error if `ELEVENLABS_API_KEY` is missing (not a cryptic network
  error).
- Throws a descriptive error on a 4xx response from ElevenLabs.
- `ELEVENLABS_API_KEY` does not appear in any thrown error message (key-leak guard).

### Step 3 — Walrus audio storage

`apps/operator/src/agents/drill-cypher/store-audio.ts`

```ts
export async function storeTrack(audio: Buffer, metadata: TrackMetadata): Promise<WalrusReceipt>
// WalrusReceipt: { blobId, aggregatorUrl, epochs }
```

Tests:
- `storeTrack(sampleMp3Buffer, { title: "test", style: "ny-drill" })` returns a blobId
  that is retrievable via `walrusClient.get(blobId)` and byte-identical to the input.
- Content is retrievable from the public aggregator URL (HTTP GET, not operator-mediated).
- `aggregatorUrl` is a fully qualified HTTPS URL pointing to the Walrus testnet aggregator.

### Step 4 — end-to-end orchestration

`apps/operator/src/agents/drill-cypher/run.ts`

```ts
export async function runDrillCypher(input: DrillInput): Promise<DrillResult>
// DrillResult: { lyrics: string, blobId: string, aggregatorUrl: string, receiptId: string }
```

Tests:
- End-to-end: `runDrillCypher({ opps: ["AUDIT"], style: "ny-drill" })` returns all four
  fields populated; `blobId` is a non-empty string.
- The receipt generated during the run includes the `blobId` in its metadata (assert via
  the operator receipt store).

### Step 5 — HTTP endpoint + x402 gating

- `POST /run/drill-cypher` registered in operator routes.
- x402 price header: `X-Payment-Required: 3.00 USDC`.
- Response body: JSON `{ lyrics, blobId, aggregatorUrl, receiptId }`.

Tests:
- Returns 402 with x402 challenge headers when no payment attached.
- Returns 200 with valid response body when payment included.
- `aggregatorUrl` in the response body resolves to audio content (HTTP GET).

### Step 6 — Web UI listing

- Agent card: price badge (3.00 USDC), "What it does" 2-liner, input form (opps list,
  style selector, extra bars text field).
- After a run: inline audio player pointing at the Walrus aggregator URL (HTML5
  `<audio src={aggregatorUrl} controls />`).
- `deprecated: false` in `apps/web/src/lib/agent-metadata.ts`.

## Acceptance criteria / THE DEMO

The demo is: walk up to a group of hackers, ask who their competitors are, type them in,
pay 3 USDC, and play the resulting drill track from a Walrus URL on the platform.

- [ ] `POST /run/drill-cypher { opps: ["<real project name>"], style: "ny-drill" }` returns within
      90 s (wall clock including ElevenLabs generation time).
- [ ] The returned `aggregatorUrl` plays audio in a browser (`<audio>` tag, no download
      required).
- [ ] Audio is recognisably drill (rhythm, vocal performance, not robot TTS).
- [ ] The lyrics name at least one "opp" from the input array.
- [ ] `blobId` resolves on the Walrus testnet aggregator directly (not proxied through the
      operator).
- [ ] x402 payment of 3.00 USDC recorded in the platform P&L ([06](06-revenue-and-economics.md)).
- [ ] `ELEVENLABS_API_KEY` does not appear anywhere in the Walrus-pinned receipt transcript.
- [ ] Web platform shows an inline audio player after a successful run — judges can play
      the track without leaving the Slopstock UI.

## De-risk result

_(Fill this in after running the smoke-elevenlabs-music.ts gate script.)_

| Field | Result |
|---|---|
| Endpoint used | `TBD` |
| Response time | `TBD` |
| Audio quality verdict | `TBD` |
| ElevenLabs pricing per call | `TBD` |
| Gate status | 🔲 not yet run |

## Stop-losses

- **De-risk gate fails (audio quality bad / endpoint broken):** the entire plan is
  blocked. Do not spend time wiring the agent. Escalate immediately: is there a different
  ElevenLabs endpoint (v1, v2, music/generate)? Is the account tier too low? Is there an
  alternative (Suno API, Udio API)? **Decision point before Saturday 10:00 AM.** If no
  audio provider works by Saturday 11:00 AM, drop plan 11 and redirect the time to
  plan 04 (Dynamic) or plan 03 (Walrus amnesia).
- **ElevenLabs rate limit at the venue:** Music v2 calls may be throttled on lower tiers.
  Have a second API key ready (create a second free account the night before). At the
  venue, do not run demo runs for spectators — reserve keys for judges.
- **Walrus testnet publisher flaky:** same failover list as [03](03-walrus.md). If a
  publisher is down, rotate to the next. The audio gate is the expensive operation;
  Walrus is cheap and fast (~6 s writes per [03](03-walrus.md) benchmarks).
- **Lyrics are unfunny or too mild:** run a second inference with `temperature: 0.9`
  and pick the better output. Two inference calls at ~$0.006 total is noise. Have a
  fallback hardcoded "demo mode" lyric for the judges that was pre-approved and is
  definitively hilarious.
- **ElevenLabs key leaks into a receipt:** add a scrubber in the receipt-building code
  that asserts `!JSON.stringify(receipt).includes(apiKey.slice(0,8))` before pinning.
  This test catches the most likely leak vector (accidental env serialisation).

## Walrus bounty angle (explicit)

Plan [03](03-walrus.md) covers skills/memory/manifests storage (the "agent knowledge"
story). The drill-cypher agent extends the Walrus submission narrative to **media
storage**: a user-facing media asset (generated audio) stored permanently and served
publicly from the decentralized network. This is the "real product adopting Walrus for
production content" story that the bounty judges said they are looking for. The two
angles are complementary; mention both in the Walrus submission writeup.

## Resources

- ElevenLabs Music v2 API: https://elevenlabs.io/docs/api-reference/sound-generation
- ElevenLabs pricing: https://elevenlabs.io/pricing
- 0G Compute tone-latitude proof: `apps/operator/scripts/smoke-0g-tone-test.ts`
- 0G Compute provider: `0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0` (deepseek-v3)
- Walrus client + benchmarks: [03](03-walrus.md), `apps/operator/src/storage/walrus-client.ts`
- Agent secrets / Tier-1 operator env: [09](09-agent-secrets.md)
- x402 payment rails: [05](05-x402-v2.md)
- Revenue / P&L: [06](06-revenue-and-economics.md)
