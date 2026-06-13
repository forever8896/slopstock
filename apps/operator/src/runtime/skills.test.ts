import { describe, expect, test } from "bun:test";
import { buildSkillIndex, skillSlug, upsertVersionLine, ensureSkillFrontmatter } from "./skills.ts";
import type { SkillDoc } from "./hermes.ts";

const doc = (name: string, description: string): SkillDoc => ({
  name, filename: `skills/${name}.md`, frontmatter: { description }, body: "body",
});

describe("buildSkillIndex", () => {
  test("renders one Level-0 line per skill, no bodies", () => {
    const out = buildSkillIndex([doc("reentrancy", "find reentrancy"), doc("oracle", "price checks")]);
    expect(out).toBe("▸ reentrancy: find reentrancy\n▸ oracle: price checks");
    expect(out).not.toContain("body");
  });
  test("empty list yields a placeholder", () => {
    expect(buildSkillIndex([])).toBe("(no skills yet)");
  });
});

describe("skillSlug", () => {
  test("kebab-cases and strips junk", () => {
    expect(skillSlug("Oracle Manipulation!")).toBe("oracle-manipulation");
    expect(skillSlug("  --Weird__Name--  ")).toBe("weird-name");
    expect(skillSlug("")).toBe("skill");
  });
});

describe("upsertVersionLine", () => {
  test("adds version to frontmatter that lacks it", () => {
    const out = upsertVersionLine("---\nname: x\n---\nbody", 2);
    expect(out).toContain("version: 2");
    expect(out).toContain("name: x");
  });
  test("replaces an existing version", () => {
    const out = upsertVersionLine("---\nversion: 1\nname: x\n---\nbody", 5);
    expect(out).toContain("version: 5");
    expect(out).not.toContain("version: 1");
  });
  test("wraps frontmatter when none present", () => {
    const out = upsertVersionLine("just a body", 1);
    expect(out.startsWith("---\nversion: 1\n---\n")).toBe(true);
  });
});

describe("ensureSkillFrontmatter", () => {
  test("leaves existing frontmatter untouched", () => {
    const body = "---\nname: a\n---\nx";
    expect(ensureSkillFrontmatter("a", body)).toBe(body);
  });
  test("wraps a bare body with name/description/version", () => {
    const out = ensureSkillFrontmatter("my-skill", "First line of knowledge\nmore");
    expect(out).toContain("name: my-skill");
    expect(out).toContain("description: First line of knowledge");
    expect(out).toContain("version: 1");
  });
});
