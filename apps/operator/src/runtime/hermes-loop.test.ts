import { describe, expect, test } from "bun:test";
import { buildSystemContent } from "./hermes-loop.ts";

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
