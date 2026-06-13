import { test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedAgentSystemPrompt } from "./seed-agent-dir.ts";

test("writes system.md from the prompt when none exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "seed-"));
  await seedAgentSystemPrompt(root, 42n, "You are a haiku agent.");
  expect(await readFile(join(root, "42", "system.md"), "utf-8")).toBe("You are a haiku agent.");
});

test("does NOT overwrite an existing system.md (self-improvement preserved)", async () => {
  const root = await mkdtemp(join(tmpdir(), "seed-"));
  await mkdir(join(root, "7"), { recursive: true });
  await writeFile(join(root, "7", "system.md"), "EVOLVED PROMPT");
  await seedAgentSystemPrompt(root, 7n, "original");
  expect(await readFile(join(root, "7", "system.md"), "utf-8")).toBe("EVOLVED PROMPT");
});
