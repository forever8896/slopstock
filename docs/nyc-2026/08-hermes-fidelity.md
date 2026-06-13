# 08 — Hermes Fidelity: make `hermes-pattern` true to the real Hermes Agent

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax. TDD on everything — `bun test`, colocated
> `*.test.ts`, `bun:test` (`describe/expect/test`). Precedent: `apps/operator/src/http/x402-v2.test.ts`.

**Goal:** Close the four largest fidelity gaps between our TS `hermes-pattern` runtime and Nous
Research's real **Hermes Agent** — so the claim in `hermes.ts:5` ("pattern derived from Hermes
Agent") is honest *and* the live demo gets stronger.

**Architecture:** Three changes to the runtime, all additive. (1) **Progressive disclosure** —
stop dumping every skill body into the system prompt; ship a Level-0 index + `skills_list` /
`skill_view` tools that pull bodies on demand. (2) **Self-improving skills** — a `skill_manage`
tool plus slug-keyed upsert so the agent *edits* skills in place instead of accreting
`skill-<uuid>.md` duplicates. (3) **Three-layer memory** — add Layer 1: human-readable, bounded
`MEMORY.md` / `USER.md` read once into the (frozen) system prompt, written by the `note` tool.
Plus the trivial trigger fix (3→5 tool calls + error-recovery).

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, viem. No new deps.

**Why (research basis):** see the gap table in the session research. Real Hermes uses
progressive disclosure (`skills_list()` ~3k-token index → `skill_view(name)` on demand), a
`skill_manage` write path with `create/edit/delete`, a three-layer memory whose Layer 1 is
frozen `MEMORY.md`(~2200c)+`USER.md`(~1375c) embedded once in the system prompt, and a 5+
tool-call skill-creation trigger. We currently do none of those: `hermes-loop.ts:113-116` dumps
all skill bodies; `hermes-loop.ts:283` only ever creates; `MIN_TOOLS_FOR_SKILL=3`; no Layer 1.

**Demo synergy:** Layer 1 (`MEMORY.md`) is human-readable, so the **Walrus amnesia demo**
([03-walrus.md](03-walrus.md)) becomes "wipe the agent, restore from Walrus, and the audience
*reads* what it remembered" instead of restoring an opaque `.db`. Self-improving skills give the
on-stage line "watch AUDIT improve the *same* skill across two audits."

**Non-goal (explicit deviation):** native function-calling. Real Hermes auto-detects
`anthropic_messages`/`chat_completions` tool roles; we keep JSON-in-text because the 0G Compute
TeeML brain (deepseek-v3) is the constraint. Document it; do not "fix" it this weekend.

**Scope / order:** Tasks 1–8 are the core PR. Land trunk-first per
[07-build-order-checklist.md](07-build-order-checklist.md) Phase 2 discipline. Each task is a
green `bun test` + a commit.

---

## File structure

**Create:**
- `apps/operator/src/runtime/skills.ts` — pure + fs skill helpers (index, slug, version,
  frontmatter, read/list/upsert). One responsibility: skill files on disk.
- `apps/operator/src/runtime/memory-files.ts` — Layer-1 frozen memory: load + bounded append.
- `apps/operator/src/runtime/skills.test.ts`
- `apps/operator/src/runtime/memory-files.test.ts`
- `apps/operator/src/runtime/hermes-tools.test.ts`
- `apps/operator/src/runtime/hermes-loop.test.ts`

**Modify:**
- `apps/operator/src/runtime/hermes-tools.ts` — add `skills_list`, `skill_view`, `skill_manage`;
  `note` also appends to `MEMORY.md`.
- `apps/operator/src/runtime/hermes-loop.ts` — extract `buildSystemContent` (Level-0 index +
  frozen memory); `MIN_TOOLS_FOR_SKILL=5`; `sawErrorRecovery`; upsert-based synthesis.
- `apps/operator/src/runtime/hermes.ts` — load `MEMORY.md`/`USER.md` into state; pass to loop.

---

## Task 1: Pure skill helpers (`skills.ts`)

**Files:**
- Create: `apps/operator/src/runtime/skills.ts`
- Test: `apps/operator/src/runtime/skills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/operator/src/runtime/skills.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/skills.test.ts`
Expected: FAIL — `Cannot find module './skills.ts'`.

- [ ] **Step 3: Write minimal implementation (pure parts only)**

```ts
// apps/operator/src/runtime/skills.ts
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, rm } from "node:fs/promises";
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
  const fm = doc.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fm) return `---\nversion: ${version}\n---\n${doc.trim()}\n`;
  let front = fm[1]!;
  if (/^version:\s*\d+/m.test(front)) {
    front = front.replace(/^version:\s*\d+.*$/m, `version: ${version}`);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/operator && bun test src/runtime/skills.test.ts`
Expected: PASS (4 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/skills.ts apps/operator/src/runtime/skills.test.ts
git commit -m "feat(hermes): pure skill helpers (index, slug, version, frontmatter)"
```

---

## Task 2: FS skill helpers — read / list / upsert (`skills.ts`)

**Files:**
- Modify: `apps/operator/src/runtime/skills.ts` (append)
- Test: `apps/operator/src/runtime/skills.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to apps/operator/src/runtime/skills.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/skills.test.ts`
Expected: FAIL — `upsertSkill` / `readSkillBody` / `listSkillStems` not exported.

- [ ] **Step 3: Write minimal implementation (append to `skills.ts`)**

```ts
// append to apps/operator/src/runtime/skills.ts

/** Read one skill body by name (slugged) from <dir>/skills/<stem>.md. */
export async function readSkillBody(dir: string, name: string): Promise<string | null> {
  const path = join(dir, "skills", `${skillSlug(name)}.md`);
  if (!existsSync(path)) return null;
  return readFile(path, "utf-8");
}

/** List skill stems present on disk, sorted. */
export async function listSkillStems(dir: string): Promise<string[]> {
  try {
    return (await readdir(join(dir, "skills")))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

/** Create or update a skill keyed by slug(name). Existing → version bump +
 *  body replace; new → v1. Returns the action + resulting version. */
export async function upsertSkill(
  dir: string,
  name: string,
  body: string,
): Promise<{ stem: string; action: "create" | "update"; version: number }> {
  const stem = skillSlug(name);
  await mkdir(join(dir, "skills"), { recursive: true });
  const path = join(dir, "skills", `${stem}.md`);
  const existed = existsSync(path);
  let version = 1;
  if (existed) {
    const prev = await readFile(path, "utf-8");
    const m = prev.match(/^version:\s*(\d+)/m);
    version = (m ? Number(m[1]) : 1) + 1;
  }
  await writeFile(path, upsertVersionLine(body, version), "utf-8");
  return { stem, action: existed ? "update" : "create", version };
}

/** Delete a skill by name. Returns true if a file was removed. */
export async function deleteSkill(dir: string, name: string): Promise<boolean> {
  const path = join(dir, "skills", `${skillSlug(name)}.md`);
  if (!existsSync(path)) return false;
  await rm(path);
  return true;
}
```

Add `mkdir` to the existing `node:fs/promises` import at the top of `skills.ts`:
`import { readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/operator && bun test src/runtime/skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/skills.ts apps/operator/src/runtime/skills.test.ts
git commit -m "feat(hermes): disk-backed skill read/list/upsert/delete (slug-keyed self-improvement)"
```

---

## Task 3: Layer-1 frozen memory (`memory-files.ts`)

**Files:**
- Create: `apps/operator/src/runtime/memory-files.ts`
- Test: `apps/operator/src/runtime/memory-files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/operator/src/runtime/memory-files.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/memory-files.test.ts`
Expected: FAIL — `Cannot find module './memory-files.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/operator/src/runtime/memory-files.ts
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Char caps for the frozen Layer-1 snapshots folded into the system prompt.
 *  Bounded so memory growth never blows context — Hermes Agent's "bounded,
 *  curated memory." (Real Hermes: MEMORY.md ~2200c, USER.md ~1375c.) */
export const MEMORY_MD_CAP = 4000;
export const USER_MD_CAP = 2000;

export interface FrozenMemory {
  memory: string; // MEMORY.md (capped), "" if absent
  user: string;   // USER.md (capped), "" if absent
}

/** Layer 1 of the three-layer memory: human-readable snapshots read ONCE at
 *  session start and embedded immutably in the system prompt. */
export async function loadFrozenMemory(dir: string): Promise<FrozenMemory> {
  return {
    memory: await readCapped(join(dir, "MEMORY.md"), MEMORY_MD_CAP),
    user: await readCapped(join(dir, "USER.md"), USER_MD_CAP),
  };
}

async function readCapped(path: string, cap: number): Promise<string> {
  if (!existsSync(path)) return "";
  const raw = await readFile(path, "utf-8");
  return raw.length > cap ? raw.slice(0, cap) + "\n…(truncated)" : raw;
}

/** Append a curated fact to MEMORY.md, trimming oldest bullets to stay under
 *  the cap. Called by the `note` tool so memory is BOTH queryable (SQLite) and
 *  human-readable (MEMORY.md → great for the Walrus restore demo). */
export async function appendMemoryLine(dir: string, line: string): Promise<void> {
  const path = join(dir, "MEMORY.md");
  const clean = `- ${line.replace(/\n+/g, " ").trim()}`;
  const prev = existsSync(path) ? await readFile(path, "utf-8") : "# Agent memory";
  let next = `${prev.replace(/\n+$/, "")}\n${clean}\n`;
  if (next.length > MEMORY_MD_CAP) {
    const lines = next.split("\n");
    const header = lines[0] ?? "# Agent memory";
    const body = lines.slice(1).filter((l) => l.length > 0);
    while (header.length + body.join("\n").length + 1 > MEMORY_MD_CAP && body.length > 1) {
      body.shift();
    }
    next = `${header}\n${body.join("\n")}\n`;
  }
  await writeFile(path, next, "utf-8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/operator && bun test src/runtime/memory-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/memory-files.ts apps/operator/src/runtime/memory-files.test.ts
git commit -m "feat(hermes): Layer-1 frozen memory (MEMORY.md/USER.md load + bounded append)"
```

---

## Task 4: Progressive-disclosure tools (`skills_list`, `skill_view`, `skill_manage`)

**Files:**
- Modify: `apps/operator/src/runtime/hermes-tools.ts` (add 3 tools + register)
- Test: `apps/operator/src/runtime/hermes-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/operator/src/runtime/hermes-tools.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_REGISTRY, type ToolCtx } from "./hermes-tools.ts";
import { readSkillBody } from "./skills.ts";

async function ctxWithDir(): Promise<ToolCtx> {
  const dir = await mkdtemp(join(tmpdir(), "hermes-tools-"));
  await mkdir(join(dir, "skills"), { recursive: true });
  // Minimal ToolCtx — these tools only touch agentDir.
  return {
    input: "", agentDir: dir, db: undefined as never, callId: "t", callerTokenId: 1n,
    subscriber: "0x0000000000000000000000000000000000000000", config: {} as never,
    peerOperatorUrl: "http://127.0.0.1:0",
  };
}

describe("skill_manage / skills_list / skill_view round-trip", () => {
  test("create → list → view", async () => {
    const ctx = await ctxWithDir();
    const created = await TOOL_REGISTRY["skill_manage"]!.handler(
      { op: "create", name: "Oracle Manipulation", content: "Use TWAP. Check staleness." }, ctx,
    );
    expect(created.resultSummary).toContain("create");

    const listed = await TOOL_REGISTRY["skills_list"]!.handler({}, ctx);
    expect(listed.text).toContain("oracle-manipulation");

    const viewed = await TOOL_REGISTRY["skill_view"]!.handler({ name: "oracle-manipulation" }, ctx);
    expect(viewed.text).toContain("Use TWAP");
    expect(viewed.text).toContain("version: 1");
  });

  test("edit bumps version in place (self-improvement, no duplicate)", async () => {
    const ctx = await ctxWithDir();
    await TOOL_REGISTRY["skill_manage"]!.handler({ op: "create", name: "reentrancy", content: "v1" }, ctx);
    await TOOL_REGISTRY["skill_manage"]!.handler({ op: "edit", name: "reentrancy", content: "v2 better" }, ctx);
    const body = await readSkillBody(ctx.agentDir, "reentrancy");
    expect(body).toContain("v2 better");
    expect(body).toContain("version: 2");
    const listed = await TOOL_REGISTRY["skills_list"]!.handler({}, ctx);
    expect(listed.text.match(/reentrancy/g)?.length).toBe(1); // exactly one, not duped
  });

  test("skill_view miss lists available", async () => {
    const ctx = await ctxWithDir();
    const r = await TOOL_REGISTRY["skill_view"]!.handler({ name: "ghost" }, ctx);
    expect(r.resultSummary).toContain("miss");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/hermes-tools.test.ts`
Expected: FAIL — `TOOL_REGISTRY["skill_manage"]` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `apps/operator/src/runtime/hermes-tools.ts`, add imports near the top:

```ts
import { listSkillStems, readSkillBody, upsertSkill, deleteSkill, skillSlug, ensureSkillFrontmatter } from "./skills.ts";
import { appendMemoryLine } from "./memory-files.ts";
```

Add the three tools (anywhere above `TOOL_REGISTRY`):

```ts
const skillsList: ToolDef = {
  name: "skills_list",
  description:
    "List your accumulated skills (names + descriptions only — Level 0). Call this first to see what you already know before tackling a task; then skill_view to read one in full.",
  argsSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, ctx) {
    const stems = await listSkillStems(ctx.agentDir);
    if (stems.length === 0) return { text: "(no skills yet)", resultSummary: "0 skills" };
    const lines: string[] = [];
    for (const stem of stems) {
      const body = await readSkillBody(ctx.agentDir, stem);
      const desc = body?.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      lines.push(`▸ ${stem}: ${desc}`);
    }
    return { text: lines.join("\n"), resultSummary: `${stems.length} skills` };
  },
};

const skillView: ToolDef = {
  name: "skill_view",
  description:
    "Read the full content of one skill by its stem (as shown by skills_list). Pull a skill into context only when it's relevant — Level 1 of progressive disclosure.",
  argsSchema: {
    type: "object",
    properties: { name: { type: "string", description: "skill stem, e.g. 'oracle-manipulation'" } },
    required: ["name"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const name = String(args["name"] ?? "").trim();
    if (!name) return { text: "(missing name)", resultSummary: "missing name" };
    const body = await readSkillBody(ctx.agentDir, name);
    if (body === null) {
      const stems = await listSkillStems(ctx.agentDir);
      return { text: `(no skill '${name}'); available: ${stems.join(", ") || "(none)"}`, resultSummary: `miss: ${name}` };
    }
    return { text: body, resultSummary: `viewed ${skillSlug(name)} (${body.length}b)` };
  },
};

const skillManage: ToolDef = {
  name: "skill_manage",
  description:
    "Create or improve a skill so you remember a workflow next time. op: 'create' | 'edit' | 'delete'. Provide a short kebab `name`; for create/edit provide a Markdown `content` body. Prefer 'edit' on an existing skill over making near-duplicates — improving skills in place is how you get better over time.",
  argsSchema: {
    type: "object",
    properties: {
      op: { type: "string", enum: ["create", "edit", "delete"] },
      name: { type: "string", description: "short skill title, e.g. 'oracle-manipulation'" },
      content: { type: "string", description: "Markdown body (for create/edit)" },
    },
    required: ["op", "name"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const op = String(args["op"] ?? "");
    const name = String(args["name"] ?? "").trim();
    if (!name) return { text: "(missing name)", resultSummary: "missing name" };
    if (op === "delete") {
      const ok = await deleteSkill(ctx.agentDir, name);
      return ok
        ? { text: `deleted ${skillSlug(name)}`, resultSummary: `deleted ${skillSlug(name)}` }
        : { text: `(no skill '${name}' to delete)`, resultSummary: "delete miss" };
    }
    const content = String(args["content"] ?? "").trim();
    if (!content) return { text: "(create/edit needs content)", resultSummary: "missing content" };
    const res = await upsertSkill(ctx.agentDir, name, ensureSkillFrontmatter(name, content));
    return {
      text: `${res.action}d skill '${res.stem}' (v${res.version})`,
      resultSummary: `${res.action} ${res.stem} v${res.version}`,
    };
  },
};
```

Register all three in `TOOL_REGISTRY` (extend the existing object literal):

```ts
export const TOOL_REGISTRY: Record<string, ToolDef> = {
  parse_ast: parseAst,
  pattern_search: patternSearch,
  recall,
  note,
  query_agent: queryAgent,
  fetch_url: fetchUrlTool,
  onchain_read: onchainReadTool,
  image_gen: imageGenTool,
  skills_list: skillsList,
  skill_view: skillView,
  skill_manage: skillManage,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/operator && bun test src/runtime/hermes-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/hermes-tools.ts apps/operator/src/runtime/hermes-tools.test.ts
git commit -m "feat(hermes): progressive-disclosure tools — skills_list/skill_view/skill_manage"
```

---

## Task 5: `note` writes human-readable MEMORY.md too

**Files:**
- Modify: `apps/operator/src/runtime/hermes-tools.ts` (`note` handler)
- Test: `apps/operator/src/runtime/hermes-tools.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to apps/operator/src/runtime/hermes-tools.test.ts
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";

test("note appends to MEMORY.md as well as the facts table", async () => {
  const ctx = await ctxWithDir();
  const db = new Database(":memory:");
  db.exec("CREATE TABLE facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL);");
  (ctx as { db: Database }).db = db;

  await TOOL_REGISTRY["note"]!.handler({ key: "oracle-rule", value: "prefer TWAP" }, ctx);

  const raw = await readFile(join(ctx.agentDir, "MEMORY.md"), "utf-8");
  expect(raw).toContain("oracle-rule: prefer TWAP");
  const row = db.prepare("SELECT value FROM facts WHERE key = ?").get("oracle-rule") as { value: string };
  expect(row.value).toBe("prefer TWAP");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/hermes-tools.test.ts -t "note appends"`
Expected: FAIL — `MEMORY.md` not written (ENOENT).

- [ ] **Step 3: Write minimal implementation**

In the `note` tool handler (`hermes-tools.ts`), after the `facts` insert and before `return`, add:

```ts
    // Mirror the fact into human-readable Layer-1 memory so it persists into
    // the next session's frozen system prompt (and into Walrus snapshots).
    await appendMemoryLine(ctx.agentDir, `${key}: ${value}`).catch(() => {});
```

(The `appendMemoryLine` import was already added in Task 4.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/operator && bun test src/runtime/hermes-tools.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/hermes-tools.ts apps/operator/src/runtime/hermes-tools.test.ts
git commit -m "feat(hermes): note tool mirrors facts into human-readable MEMORY.md"
```

---

## Task 6: System prompt → Level-0 index + frozen memory (`hermes-loop.ts`)

**Files:**
- Modify: `apps/operator/src/runtime/hermes-loop.ts` (extract `buildSystemContent`, use it)
- Test: `apps/operator/src/runtime/hermes-loop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/operator/src/runtime/hermes-loop.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/hermes-loop.test.ts`
Expected: FAIL — `buildSystemContent` not exported.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `hermes-loop.ts`:

```ts
import { buildSkillIndex } from "./skills.ts";
import type { FrozenMemory } from "./memory-files.ts";
```

Extend `AgentStateLite` (in `hermes-loop.ts`) with the frozen-memory field:

```ts
interface AgentStateLite {
  dir: string;
  db: import("bun:sqlite").Database;
  systemPrompt: string;
  skills: SkillDoc[];
  tools?: string[];
  frozenMemory?: FrozenMemory; // Layer 1 — embedded once, frozen for the session
}
```

Add the exported builder (top-level function in `hermes-loop.ts`):

```ts
/** Assemble the (frozen-for-the-session) system prompt. Skills appear as a
 *  Level-0 index only — bodies are pulled on demand via skill_view. Mirrors
 *  Hermes Agent's SKILLS_GUIDANCE block (index + creation nudge). */
export function buildSystemContent(opts: {
  systemPrompt: string;
  tools: { name: string; description: string }[];
  skillIndex: string;
  frozenMemory?: FrozenMemory;
}): string {
  const { systemPrompt, tools, skillIndex, frozenMemory } = opts;
  const parts: string[] = [systemPrompt.trim(), ""];

  if (frozenMemory && (frozenMemory.user.trim() || frozenMemory.memory.trim())) {
    parts.push("── what you remember (read-only this session) ──────────────");
    if (frozenMemory.user.trim()) parts.push(`USER:\n${frozenMemory.user.trim()}`);
    if (frozenMemory.memory.trim()) parts.push(`MEMORY:\n${frozenMemory.memory.trim()}`);
    parts.push("");
  }

  parts.push(
    "── available tools ──────────────────────────────────────────",
    tools.length === 0
      ? "(none — emit your final answer directly)"
      : tools.map((t) => `  - ${t.name}: ${t.description}`).join("\n"),
    "",
    "── how to call a tool ──────────────────────────────────────",
    `Emit a JSON object: {"tool": "<name>", "args": { ... }}`,
    "Nothing else. The runtime executes it and replies with the result on the next turn.",
    "",
    "── how to finish ───────────────────────────────────────────",
    `Emit ONLY a final JSON answer (an object that does NOT have a "tool" key). No prose, no markdown fences. The exact schema lives in your role definition above.`,
    "",
    "── your skills (Level 0 index) ─────────────────────────────",
    skillIndex,
    `To read a skill's full body, call {"tool":"skill_view","args":{"name":"<stem>"}}. When you finish a task that took 5+ tool calls or where you found a non-obvious path, SAVE it: {"tool":"skill_manage","args":{"op":"create","name":"<title>","content":"<markdown>"}} — or 'edit' an existing skill to improve it.`,
  );

  return parts.filter((x) => x !== "").join("\n");
}
```

Now replace the inline `systemContent` assembly in `runAgentLoop` (currently
`hermes-loop.ts:98-119`) with a call to the builder:

```ts
  const allowedTools = state.tools ?? Object.keys(TOOL_REGISTRY);
  const toolList = allowedTools
    .map((name) => TOOL_REGISTRY[name])
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const systemContent = buildSystemContent({
    systemPrompt: state.systemPrompt,
    tools: toolList.map((t) => ({ name: t.name, description: t.description })),
    skillIndex: buildSkillIndex(state.skills),
    ...(state.frozenMemory ? { frozenMemory: state.frozenMemory } : {}),
  });
```

Delete the now-dead `state.skills.map(... s.body.slice(0, 4000) ...)` block — skill *bodies*
must no longer enter the system prompt (that's the whole point).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/operator && bun test src/runtime/hermes-loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/hermes-loop.ts apps/operator/src/runtime/hermes-loop.test.ts
git commit -m "feat(hermes): progressive disclosure — Level-0 skill index + frozen memory in system prompt"
```

---

## Task 7: Trigger fix (3→5 + error-recovery) and upsert-based skill synthesis

**Files:**
- Modify: `apps/operator/src/runtime/hermes-loop.ts` (`MIN_TOOLS_FOR_SKILL`, `sawErrorRecovery`, synthesis block)
- Test: `apps/operator/src/runtime/hermes-loop.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to apps/operator/src/runtime/hermes-loop.test.ts
import { sawErrorRecovery } from "./hermes-loop.ts";
import type { AgentStep } from "@stratum/shared";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/hermes-loop.test.ts -t sawErrorRecovery`
Expected: FAIL — `sawErrorRecovery` not exported.

- [ ] **Step 3: Write minimal implementation**

In `hermes-loop.ts`, bump the constant (currently `hermes-loop.ts:33`):

```ts
const MIN_TOOLS_FOR_SKILL = 5; // was 3 — match real Hermes Agent's 5+ trigger
```

Add the exported detector (top-level function):

```ts
/** Did the agent hit a tool error and then recover with a later success? Real
 *  Hermes treats "found the working path after a dead end" as skill-worthy,
 *  independent of raw tool count. Summaries flagged by the loop as errors use
 *  words like error/fail/threw/unknown/miss. */
export function sawErrorRecovery(transcript: AgentStep[]): boolean {
  let sawError = false;
  for (const s of transcript) {
    if (s.kind !== "tool") continue;
    const errored = /error|fail|threw|unknown|not whitelisted|\bmiss\b/i.test(s.resultSummary);
    if (errored) sawError = true;
    else if (sawError) return true;
  }
  return false;
}
```

Replace the post-loop skill-creation block (currently `hermes-loop.ts:274-292`) with the
upsert-based, recovery-aware version:

```ts
  // Skill auto-creation/improvement after a "hard" task. Slug-keyed upsert means
  // a recurring task type UPDATES its skill in place (self-improvement) instead
  // of spawning skill-<uuid>.md duplicates.
  const skillsCreated: string[] = [];
  const skillWorthy = toolCallCount >= MIN_TOOLS_FOR_SKILL || sawErrorRecovery(transcript);
  if (skillWorthy && finalAnswer) {
    try {
      const skill = await synthesizeSkill(input.backend, {
        userInput: req.input,
        transcript,
        finalAnswer,
      });
      if (skill) {
        const declaredName =
          skill.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? `skill-${callId.slice(0, 8)}`;
        const res = await upsertSkill(state.dir, declaredName, skill);
        skillsCreated.push(res.stem);
        transcript.push({ kind: "skill_create", skill: res.stem, ts: Math.floor(Date.now() / 1000) });
      }
    } catch {
      // Non-fatal; the audit still ships.
    }
  }
```

Add the import at the top of `hermes-loop.ts` (extend the existing `./skills.ts` import from Task 6):

```ts
import { buildSkillIndex, upsertSkill } from "./skills.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/operator && bun test src/runtime/hermes-loop.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/hermes-loop.ts apps/operator/src/runtime/hermes-loop.test.ts
git commit -m "feat(hermes): 5+ tool / error-recovery skill trigger; upsert (improve-in-place) synthesis"
```

---

## Task 8: Wire frozen memory into the runtime (`hermes.ts`)

**Files:**
- Modify: `apps/operator/src/runtime/hermes.ts` (`AgentState`, `load`, `runTask`)

- [ ] **Step 1: Write the failing test**

```ts
// append to apps/operator/src/runtime/hermes-loop.test.ts (state plumbing is exercised here)
import { loadFrozenMemory } from "./memory-files.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

test("frozenMemory loaded from disk surfaces in the system prompt", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), "hermes-fm-"));
  await writeFile(joinPath(dir, "MEMORY.md"), "- remembered: ORCL likes TWAP");
  const fm = await loadFrozenMemory(dir);
  const out = buildSystemContent({
    systemPrompt: "ROLE", tools: [], skillIndex: "(no skills yet)", frozenMemory: fm,
  });
  expect(out).toContain("remembered: ORCL likes TWAP");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/operator && bun test src/runtime/hermes-loop.test.ts -t "frozenMemory loaded"`
Expected: PASS *for this unit* already (builder + loader exist) — this guards the contract the
wiring must honor. If it fails, fix the import path. Then proceed to wire `hermes.ts` so the
runtime actually populates it (no separate test; covered by `smoke-hermes` in Task 9).

- [ ] **Step 3: Wire `hermes.ts`**

Add the import:

```ts
import { loadFrozenMemory, type FrozenMemory } from "./memory-files.ts";
```

Extend `AgentState` (in `hermes.ts`):

```ts
interface AgentState {
  dir: string;
  db: Database;
  systemPrompt: string;
  skills: SkillDoc[];
  lock: BundleLock;
  tools?: string[];
  frozenMemory: FrozenMemory; // Layer 1
}
```

In `load()`, after `const skills = await loadSkills(dir);`, load the frozen memory and include
it when building state:

```ts
    const frozenMemory = await loadFrozenMemory(dir);
```

and add `frozenMemory,` to the `this.stateByToken.set(key, { ... })` object literal.

In `runTask()`, pass it through to the loop's `state`:

```ts
      state: {
        dir: state.dir,
        db: state.db,
        systemPrompt: state.systemPrompt,
        skills: state.skills,
        frozenMemory: state.frozenMemory,
        ...(state.tools ? { tools: state.tools } : {}),
      },
```

- [ ] **Step 4: Type-check + unit tests**

Run: `cd apps/operator && bunx tsc --noEmit && bun test src/runtime/`
Expected: no type errors; all runtime tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/hermes.ts apps/operator/src/runtime/hermes-loop.test.ts
git commit -m "feat(hermes): load MEMORY.md/USER.md into runtime state and feed the loop"
```

---

## Task 9: Integration — full suite + smoke-hermes + checklist

**Files:**
- Verify only; then update `apps/operator/seed/agents/1/system.md` nudge (optional) and the
  build checklist.

- [ ] **Step 1: Full unit suite**

Run: `bun test` (repo root — `bun --filter '*' test`)
Expected: PASS, including the four new test files.

- [ ] **Step 2: Live smoke (real brain)**

Run (loads `.env`, hits the 0G deepseek-v3 brain per [00-state-and-funding.md](00-state-and-funding.md)):

```bash
bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-hermes.ts'
```

Expected: the audit completes; transcript shows `skill_load` from the Level-0 index, at least
one `skill_view` or `skill_manage`, and on a ≥5-tool run a `skill_create` for the upserted
skill. Re-run once: the **same** skill stem should bump to `version: 2` (improve-in-place), not
spawn a second file. Confirm `data/agents/1/MEMORY.md` exists and is human-readable.

- [ ] **Step 3: Optional — refresh AUDIT's system prompt nudge**

In `apps/operator/seed/agents/1/system.md`, ensure the role text invites skill use (e.g. add a
line: "Before auditing, call `skills_list`; after a hard audit, save a skill with
`skill_manage`."). Keep the final-answer JSON schema unchanged.

- [ ] **Step 4: Tick the checklist**

In [07-build-order-checklist.md](07-build-order-checklist.md), under Phase 3, add:
`- [ ] smoke-hermes shows progressive disclosure + skill improve-in-place + MEMORY.md written.`

- [ ] **Step 5: Commit**

```bash
git add apps/operator/seed/agents/1/system.md docs/nyc-2026/07-build-order-checklist.md
git commit -m "chore(hermes): smoke verification + AUDIT skill-use nudge + checklist"
```

---

## Self-review (spec coverage)

| Research gap | Task(s) | Covered |
|---|---|---|
| Progressive disclosure (`skills_list`/`skill_view`, Level-0 index, no body dump) | 1, 4, 6 | ✅ |
| Self-improving skills (`skill_manage` create/edit/delete; upsert in place) | 2, 4, 7 | ✅ |
| Skill trigger 3→5 + qualitative (error-recovery) | 7 | ✅ |
| Three-layer memory — add Layer 1 (`MEMORY.md`/`USER.md` frozen) | 3, 5, 6, 8 | ✅ |
| agentskills.io-shaped frontmatter (name/description/version) | 1 (`ensureSkillFrontmatter`/`upsertVersionLine`) | ✅ |
| Native tool-calling | — | ❌ deliberate deviation (0G TeeML constraint; documented in header) |

## Stop-losses

| If… | Then… |
|---|---|
| `bunx tsc` flags `FrozenMemory` optionality mismatch | make `frozenMemory` required in `AgentStateLite` and always pass it (loader returns empty strings, never throws) |
| smoke-hermes skill bodies still appear in prompt | confirm the `s.body.slice(0,4000)` block was deleted in Task 6 — that's the regression to guard |
| deepseek-v3 ignores `skill_manage` | the post-loop upsert synthesis (Task 7) still fires on ≥5 tools — in-loop calls are a bonus, not required |
| Time runs out after Task 6 | Tasks 1–6 alone make the "progressive disclosure" claim true; Layer-1 memory (3,5,8) can ship after the weekend |

## Invariants (unchanged)

Skill bodies never re-enter the system prompt. `MEMORY.md` stays bounded (`MEMORY_MD_CAP`).
The final-answer JSON schema and receipt shape are untouched — this is runtime-internal only.
