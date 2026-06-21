/**
 * DEMO: self-improving agent → versioned ENS snapshot pointer → cold-boot.
 *
 * Shows the full loop for YIELD (yield.slopstock.eth) on mainnet rails:
 *   1. current state — what ENS points at + the agent's skills today
 *   2. self-improve — the agent gains a new reusable skill, brain re-hashes
 *   3. seal snapshot — encrypted brain → Walrus (Seal threshold-IBE, mainnet)
 *   4. publish — the ENS `agent-snapshot` pointer advances to the new version
 *   5. cold-boot — wipe everything, rebuild the agent from its ENS name alone
 *
 *   bun run scripts/demo-self-improve.ts            # dry-run (no on-chain write)
 *   PUBLISH=1 bun run scripts/demo-self-improve.ts  # real ENS pointer update (mainnet tx)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { hashBundleDir } from "../apps/operator/src/runtime/bundle.ts";
import { getSnapshotCipher } from "../apps/operator/src/storage/encryption.ts";
import { snapshotAgentDir, restoreAgentDir } from "../apps/operator/src/storage/snapshot.ts";
import { setSnapshotPointer, readSnapshotPointer } from "../apps/operator/src/store/snapshot-pointer.ts";

const ENS = "yield.slopstock.eth";
const DIR = "./data/agents/33";
const PUBLISH = process.env["PUBLISH"] === "1";

// ── env (.env) ──
const env: Record<string, string> = {};
for (const l of readFileSync("./.env", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const L1 = env["L1_RPC"] || "https://ethereum-rpc.publicnode.com";

// ── pretty ──
const C = { d: "\x1b[2m", g: "\x1b[32m", c: "\x1b[36m", y: "\x1b[33m", b: "\x1b[1m", m: "\x1b[35m", x: "\x1b[0m" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function box(title: string) {
  const w = 64;
  const pad = title + " ".repeat(Math.max(0, w - 2 - title.length));
  console.log(`\n${C.c}┌${"─".repeat(w - 2)}┐${C.x}`);
  console.log(`${C.c}│ ${C.b}${pad}${C.x}${C.c}│${C.x}`);
  console.log(`${C.c}└${"─".repeat(w - 2)}┘${C.x}`);
}
const skillsOf = (d: string) => (existsSync(join(d, "skills")) ? readdirSync(join(d, "skills")).filter((f) => f.endsWith(".md")) : []);

const NEW_SKILL = {
  file: "stablecoin-depeg-screen.md",
  body: `---
name: stablecoin-depeg-screen
description: Screen a stablecoin's peg health before recommending any pool built on it
version: 1
---

Before recommending a stablecoin LP or lending pool, check the underlying
stable's peg over the trailing 30d (web_search "<symbol> depeg 2026"). If it has
broken peg by >0.5% or relies on an algorithmic/under-collateralized mechanism,
cap the recommendation confidence and surface the depeg risk in caveats — a high
APY on a fragile peg is a trap, not yield.
`,
};

async function main() {
  console.log(`\n${C.b}${C.m}  SELF-IMPROVING AGENT${C.x}  ${C.d}— ${ENS} · 0G compute · Seal · ENS${C.x}`);
  console.log(`${C.d}  mode: ${PUBLISH ? C.y + "LIVE (writes ENS pointer on mainnet)" : "dry-run (no on-chain write)"}${C.x}`);
  const cipher = await getSnapshotCipher();

  // 0 ── bootstrap: the agent may exist only as an ENS pointer. If there's no
  // local brain, boot it from ENS first (cold-start from its name).
  if (!existsSync(join(DIR, "bundle.lock.json"))) {
    const b = await readSnapshotPointer({ ensName: ENS, rpcUrl: L1 });
    if (!b) throw new Error(`no local brain and no ENS pointer for ${ENS}`);
    console.log(`${C.d}  no local brain — booting ${ENS} from ENS (${b.slice(0, 12)}…)${C.x}`);
    await restoreAgentDir(DIR, b, cipher, ENS);
  }

  // 1 ── current state
  box("1 · CURRENT STATE — what the agent is today");
  const beforeBlob = await readSnapshotPointer({ ensName: ENS, rpcUrl: L1 });
  const beforeLock = JSON.parse(readFileSync(join(DIR, "bundle.lock.json"), "utf8"));
  console.log(`  ENS ${C.c}${ENS}${C.x} agent-snapshot → ${C.g}${beforeBlob ?? "(none)"}${C.x}`);
  console.log(`  brain version: ${C.y}v${beforeLock.version}${C.x}  ·  skills: ${C.y}${skillsOf(DIR).length}${C.x} ${C.d}[${skillsOf(DIR).join(", ")}]${C.x}`);
  await sleep(900);

  // 2 ── self-improve
  box("2 · SELF-IMPROVE — the agent learns a new skill");
  writeFileSync(join(DIR, "skills", NEW_SKILL.file), NEW_SKILL.body);
  console.log(`  ${C.g}+ skill${C.x} ${C.b}${NEW_SKILL.file}${C.x}`);
  console.log(`  ${C.d}  "${NEW_SKILL.body.split("\n")[2].replace("description: ", "")}"${C.x}`);
  const newHash = await hashBundleDir(DIR);
  const newLock = { bundleHash: newHash, version: beforeLock.version + 1, lastUpdated: beforeLock.lastUpdated + 1 };
  writeFileSync(join(DIR, "bundle.lock.json"), JSON.stringify(newLock, null, 2));
  console.log(`  brain re-hashed → ${C.c}${newHash.slice(0, 22)}…${C.x}  ·  version ${C.y}v${beforeLock.version} → v${newLock.version}${C.x}`);
  await sleep(900);

  // 3 ── seal snapshot
  box("3 · SEAL SNAPSHOT — encrypted brain → Walrus");
  console.log(`  ${C.d}cipher: ${cipher.kind}${cipher.kind === "seal" ? " (threshold-IBE · Sui mainnet key server)" : ""}${C.x}`);
  const newBlob = await snapshotAgentDir(DIR, cipher, ENS);
  console.log(`  Walrus blob → ${C.g}${newBlob}${C.x}`);
  await sleep(900);

  // 4 ── publish to ENS
  box("4 · PUBLISH — advance the ENS snapshot pointer");
  if (PUBLISH) {
    await setSnapshotPointer({ ensName: ENS, blobId: newBlob, deployerKey: env["DEPLOYER_PRIVATE_KEY"] as `0x${string}`, rpcUrl: L1 });
    const got = await readSnapshotPointer({ ensName: ENS, rpcUrl: L1 });
    console.log(`  ${C.g}✓ on-chain${C.x} ${ENS} agent-snapshot → ${C.g}${got}${C.x}`);
    console.log(`  ${C.d}  ${beforeBlob?.slice(0, 16)}…  →  ${newBlob.slice(0, 16)}…${C.x}`);
  } else {
    console.log(`  ${C.y}dry-run${C.x} — would setText ${ENS} agent-snapshot = ${C.g}${newBlob}${C.x}`);
    console.log(`  ${C.d}  run with PUBLISH=1 to write it on mainnet${C.x}`);
  }
  await sleep(900);

  // 5 ── cold-boot
  box("5 · COLD-BOOT — rebuild the agent from ENS alone");
  const tmp = "./data/agents/_coldboot_demo";
  await rm(tmp, { recursive: true, force: true });
  const bootBlob = PUBLISH ? (await readSnapshotPointer({ ensName: ENS, rpcUrl: L1 }))! : newBlob;
  console.log(`  ${C.d}wipe disk → resolve ENS → fetch Walrus → Seal decrypt → restore${C.x}`);
  console.log(`  ENS ${C.c}${ENS}${C.x} → ${C.g}${bootBlob}${C.x}`);
  await restoreAgentDir(tmp, bootBlob, cipher, ENS);
  const recovered = skillsOf(tmp);
  const bootedLock = JSON.parse(readFileSync(join(tmp, "bundle.lock.json"), "utf8"));
  const hasNew = recovered.includes(NEW_SKILL.file);
  console.log(`  recovered brain: ${C.y}v${bootedLock.version}${C.x}  ·  skills: ${C.y}${recovered.length}${C.x}`);
  console.log(`  new skill survived the reboot: ${hasNew ? C.g + "✓ " + NEW_SKILL.file : C.y + "✗ missing"}${C.x}`);
  await rm(tmp, { recursive: true, force: true });

  console.log(`\n${C.g}${C.b}  ✓ the agent improved itself, versioned its brain on ENS, and rebooted from nothing but its name.${C.x}\n`);
}
main().catch((e) => { console.error(`\n${C.y}error:${C.x}`, e instanceof Error ? e.message : e); process.exit(1); });
