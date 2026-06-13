/**
 * Bounty validation: can we RELIABLY store + retrieve agent skills on Walrus?
 * Stores every real skill .md on Walrus testnet, reads each back N times,
 * verifies byte-identical, and reports success rate + latency + idempotency.
 *   bun run apps/operator/scripts/validate-walrus-skills.ts
 */
import { readFile } from "node:fs/promises";
import { Glob } from "bun";
import { WalrusClient } from "../src/storage/walrus-client.ts";

const READS_PER_BLOB = 3;

async function main() {
  const w = new WalrusClient();
  const files: string[] = [];
  for (const base of ["apps/operator/seed/agents", "data/agents"]) {
    for await (const f of new Glob("*/skills/*.md").scan(base)) files.push(`${base}/${f}`);
  }
  console.log(`found ${files.length} skill files\n`);
  if (files.length === 0) { console.log("⚠️ no skill files found — nothing to validate"); process.exit(1); }

  let stored = 0, readsOk = 0, readsTotal = 0, dedupOk = 0;
  const writeMs: number[] = [], readMs: number[] = [];

  for (const f of files) {
    const bytes = new Uint8Array(await readFile(f));
    // write
    let t = performance.now();
    let res;
    try { res = await w.store(bytes, { epochs: 5 }); } catch (e) { console.log(`✗ STORE ${f}: ${(e as Error).message.slice(0, 80)}`); continue; }
    writeMs.push(performance.now() - t);
    stored++;

    // read back N times, verify identical
    let allMatch = true;
    for (let i = 0; i < READS_PER_BLOB; i++) {
      readsTotal++;
      t = performance.now();
      try {
        const back = await w.read(res.blobId);
        readMs.push(performance.now() - t);
        if (Buffer.compare(Buffer.from(bytes), Buffer.from(back)) === 0) readsOk++;
        else { allMatch = false; console.log(`✗ MISMATCH ${f} read ${i}`); }
      } catch (e) { allMatch = false; console.log(`✗ READ ${f} #${i}: ${(e as Error).message.slice(0, 80)}`); }
    }

    // idempotency: re-store identical bytes -> same blobId
    const res2 = await w.store(bytes, { epochs: 5 });
    if (res2.blobId === res.blobId) dedupOk++;

    const name = f.split("/").slice(-1)[0];
    console.log(`${allMatch ? "✓" : "✗"} ${name.padEnd(24)} blob=${res.blobId.slice(0, 12)}… reads ${READS_PER_BLOB}/${READS_PER_BLOB} dedup=${res2.blobId === res.blobId}`);
  }

  const avg = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
  console.log(`\n── RESULTS ──`);
  console.log(`stored:     ${stored}/${files.length}`);
  console.log(`reads ok:   ${readsOk}/${readsTotal}`);
  console.log(`idempotent: ${dedupOk}/${stored}`);
  console.log(`write avg:  ${avg(writeMs)}ms · read avg: ${avg(readMs)}ms`);
  const reliable = stored === files.length && readsOk === readsTotal && dedupOk === stored;
  console.log(reliable ? "\n✅ WALRUS RELIABLE FOR SKILL STORAGE/RETRIEVAL" : "\n⚠️ reliability gaps above");
}
main().catch((e) => { console.error("failed:", e); process.exit(1); });
