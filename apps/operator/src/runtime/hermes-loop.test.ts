import { describe, expect, test } from "bun:test";
import { buildSystemContent, sawErrorRecovery } from "./hermes-loop.ts";
import type { AgentStep } from "@stratum/shared";
import { loadFrozenMemory } from "./memory-files.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

describe("buildSystemContent", () => {
  const tools = [{ name: "parse_ast", description: "scan" }, { name: "skill_view", description: "read a skill" }];

  test("includes the Level-0 skill index, never skill bodies", () => {
    const out = buildSystemContent({
      systemPrompt: "ROLE",
      tools,
      skillIndex: "▸ reentrancy: find reentrancy",
      frozenMemory: { memory: "", user: "" },
    });
    expect(out).toContain("ROLE");
    expect(out).toContain("▸ reentrancy: find reentrancy");
    expect(out).toContain("skill_view"); // tool advertised
    expect(out).toContain("Level 0");
  });

  test("embeds frozen MEMORY/USER when present", () => {
    const out = buildSystemContent({
      systemPrompt: "ROLE",
      tools,
      skillIndex: "(no skills yet)",
      frozenMemory: { memory: "- learned X", user: "prefers terse" },
    });
    expect(out).toContain("learned X");
    expect(out).toContain("prefers terse");
  });

  test("omits the memory block entirely when memory is empty", () => {
    const out = buildSystemContent({
      systemPrompt: "ROLE", tools, skillIndex: "(no skills yet)", frozenMemory: { memory: "", user: "" },
    });
    expect(out).not.toContain("what you remember");
  });
});

const tstep = (resultSummary: string): AgentStep => ({
  kind: "tool", tool: "x", argsHash: "0x", resultSummary, ts: 0,
});

describe("sawErrorRecovery", () => {
  test("true when a success follows a prior tool error", () => {
    expect(sawErrorRecovery([tstep("threw: boom"), tstep("12 fns, 3 ext calls")])).toBe(true);
  });
  test("false when no errors", () => {
    expect(sawErrorRecovery([tstep("ok"), tstep("ok")])).toBe(false);
  });
  test("false when the only error is the last step", () => {
    expect(sawErrorRecovery([tstep("ok"), tstep("pay failed: 0xabc")])).toBe(false);
  });
});

test("frozenMemory loaded from disk surfaces in the system prompt", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), "hermes-fm-"));
  await writeFile(joinPath(dir, "MEMORY.md"), "- remembered: ORCL likes TWAP");
  const fm = await loadFrozenMemory(dir);
  const out = buildSystemContent({
    systemPrompt: "ROLE", tools: [], skillIndex: "(no skills yet)", frozenMemory: fm,
  });
  expect(out).toContain("remembered: ORCL likes TWAP");
});
