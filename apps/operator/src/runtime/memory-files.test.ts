import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFrozenMemory, appendMemoryLine, MEMORY_MD_CAP } from "./memory-files.ts";

async function tmpDir() { return mkdtemp(join(tmpdir(), "hermes-mem-")); }

describe("loadFrozenMemory", () => {
  test("returns empty strings when files absent", async () => {
    const fm = await loadFrozenMemory(await tmpDir());
    expect(fm.memory).toBe("");
    expect(fm.user).toBe("");
  });
  test("reads MEMORY.md and USER.md", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "MEMORY.md"), "# mem\n- learned X");
    await writeFile(join(dir, "USER.md"), "prefers terse output");
    const fm = await loadFrozenMemory(dir);
    expect(fm.memory).toContain("learned X");
    expect(fm.user).toContain("terse");
  });
  test("caps oversized MEMORY.md", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "MEMORY.md"), "x".repeat(MEMORY_MD_CAP + 500));
    const fm = await loadFrozenMemory(dir);
    expect(fm.memory.length).toBeLessThanOrEqual(MEMORY_MD_CAP + 20);
    expect(fm.memory).toContain("(truncated)");
  });
});

describe("appendMemoryLine", () => {
  test("appends a bullet and persists", async () => {
    const dir = await tmpDir();
    await appendMemoryLine(dir, "oracle: use TWAP not spot");
    const raw = await readFile(join(dir, "MEMORY.md"), "utf-8");
    expect(raw).toContain("- oracle: use TWAP not spot");
  });
  test("keeps the file bounded by trimming oldest bullets", async () => {
    const dir = await tmpDir();
    for (let i = 0; i < 500; i++) await appendMemoryLine(dir, `fact ${i} ${"y".repeat(40)}`);
    const raw = await readFile(join(dir, "MEMORY.md"), "utf-8");
    expect(raw.length).toBeLessThanOrEqual(MEMORY_MD_CAP);
    expect(raw).toContain("fact 499"); // newest survives
    expect(raw).not.toContain("fact 0 "); // oldest evicted
  });
});
