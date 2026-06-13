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
  test("normalizes CRLF frontmatter instead of double-wrapping", () => {
    const out = upsertVersionLine("---\r\nname: x\r\n---\r\nbody", 2);
    expect(out).toContain("version: 2");
    expect(out).toContain("name: x");
    expect(out).not.toContain("\r");
    // exactly one frontmatter delimiter pair (no double-wrap)
    expect(out.match(/^---$/gm)?.length).toBe(2);
  });
  test("replaces a non-numeric existing version (no duplicate key)", () => {
    const out = upsertVersionLine("---\nversion: abc\nname: x\n---\nbody", 3);
    expect(out).toContain("version: 3");
    expect(out.match(/^version:/gm)?.length).toBe(1);
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

import { mkdtemp, mkdir, readFile as readFileFs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSkillBody, listSkillStems, upsertSkill } from "./skills.ts";

async function tmpAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hermes-skills-"));
  await mkdir(join(dir, "skills"), { recursive: true });
  return dir;
}

describe("upsertSkill + readSkillBody + listSkillStems", () => {
  test("create then update bumps version and replaces body", async () => {
    const dir = await tmpAgentDir();
    const first = await upsertSkill(dir, "Oracle Check", "---\nname: Oracle Check\nversion: 1\n---\nv1 body");
    expect(first.action).toBe("create");
    expect(first.stem).toBe("oracle-check");
    expect(first.version).toBe(1);

    const second = await upsertSkill(dir, "Oracle Check", "---\nname: Oracle Check\nversion: 1\n---\nv2 body");
    expect(second.action).toBe("update");
    expect(second.version).toBe(2);

    const body = await readSkillBody(dir, "Oracle Check");
    expect(body).toContain("v2 body");
    expect(body).not.toContain("v1 body");
    expect(body).toContain("version: 2");

    expect(await listSkillStems(dir)).toEqual(["oracle-check"]);
  });

  test("readSkillBody returns null for missing skill", async () => {
    const dir = await tmpAgentDir();
    expect(await readSkillBody(dir, "nope")).toBeNull();
  });
});
