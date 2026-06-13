import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SkillDoc } from "./hermes.ts";

/** Level-0 progressive-disclosure index: one line per skill, NO bodies.
 *  Mirrors Hermes Agent's skills_list() — name + description only. */
export function buildSkillIndex(skills: SkillDoc[]): string {
  if (skills.length === 0) return "(no skills yet)";
  return skills
    .map((s) => `▸ ${s.name}: ${s.frontmatter["description"] ?? "(no description)"}`)
    .join("\n");
}

/** Deterministic filename stem from a skill's declared name. Same task type →
 *  same slug → skill is UPDATED in place rather than duplicated. This is what
 *  makes the agent self-improving instead of skill-hoarding. */
export function skillSlug(name: string): string {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "skill"
  );
}

/** Insert or replace the `version:` line inside a frontmatter block. Wrap a
 *  minimal frontmatter if the doc has none. */
export function upsertVersionLine(doc: string, version: number): string {
  const normalized = doc.replace(/\r\n/g, "\n");
  const fm = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fm) return `---\nversion: ${version}\n---\n${normalized.trim()}\n`;
  let front = fm[1]!;
  if (/^version:\s*\S/m.test(front)) {
    front = front.replace(/^version:.*$/m, `version: ${version}`);
  } else {
    front = `version: ${version}\n${front}`;
  }
  return `---\n${front}\n---\n${(fm[2] ?? "").trim()}\n`;
}

/** Guarantee a skill doc carries name+description+version frontmatter
 *  (agentskills.io shape). If it already has frontmatter, leave it. */
export function ensureSkillFrontmatter(name: string, body: string): string {
  if (/^---\n/.test(body)) return body;
  const desc = body.split("\n").find((l) => l.trim().length > 0)?.slice(0, 120) ?? name;
  return `---\nname: ${name}\ndescription: ${desc}\nversion: 1\n---\n${body.trim()}\n`;
}
