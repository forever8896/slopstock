# Docs Surface — Protocol Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/docs` surface for `apps/web` as a designed protocol reference — MDX content with a bespoke figure library (flow diagrams, harness matrix, system map) — documenting the current Slopstock stack.

**Architecture:** A `/docs/[[...slug]]` catch-all (RSC) resolves a slug to an MDX file under `src/content/docs`, compiles it with `next-mdx-remote/rsc` (Shiki highlighting via `rehype-pretty-code`), and renders it inside a docs shell (left `DocsSidebar` from a `docs-nav.ts` config + right `TocRail` auto-extracted from headings). MDX files import bespoke presentational components (`FlowDiagram`, `HarnessMatrix`, `SystemMap`, `ContractCard`, callouts/steps). Everything is a Server Component — no wallet/JS bundle on docs. All styles live in `globals.css` under a new `surface-docs` scope, reusing daylight tokens.

**Tech Stack:** Next.js 15 (App Router, RSC) · React 19 · TypeScript · `next-mdx-remote` v5 (`/rsc`) · `shiki` + `rehype-pretty-code` · `remark-gfm` · `rehype-slug` · `gray-matter` · `bun` (package manager + test runner).

**Spec:** `docs/superpowers/specs/2026-06-14-docs-protocol-reference-design.md`

---

## Conventions for this plan

- All paths are relative to repo root `/home/deepseek/open-agents`.
- Run all `bun`/`tsc` commands from `apps/web` unless stated.
- Package manager is `bun`; the web package is `@stratum/web`.
- Path alias: `@/*` → `apps/web/src/*`.
- Daylight tokens already in `globals.css`: `--accent` (#1a4dff), `--accent-hover`, `--accent-dim`, `--accent-tint`, `--fg`, `--fg-2`, `--mute`, `--panel`, `--hair`, `--radius`, `--radius-sm`, `--shadow-sm/md/lg`, `--font-serif`, `--font-sans`, `--font-mono`.
- No React testing library exists in this app. Automated tests use **`bun test`** for pure logic only (slug resolution, TOC extraction, nav↔file consistency). Components and pages are verified by running the dev server and viewing the route.
- Commit after every task with the shown message.

## File structure (what gets created/modified)

**Create — pipeline/lib:**
- `apps/web/src/lib/docs/types.ts` — shared types (`DocPage`, `DocGroup`, `TocEntry`, `LoadedDoc`).
- `apps/web/src/lib/docs/docs-nav.ts` — ordered groups → pages; sidebar + params source of truth.
- `apps/web/src/lib/docs/load.ts` — slug → file path, frontmatter parse, source read.
- `apps/web/src/lib/docs/toc.ts` — extract h2/h3 from MDX source → `TocEntry[]`.
- `apps/web/src/lib/docs/mdx-components.tsx` — the component map passed to MDX.
- `apps/web/src/lib/docs/docs-nav.test.ts` — nav↔file consistency (bun test).
- `apps/web/src/lib/docs/toc.test.ts` — TOC extraction (bun test).
- `apps/web/src/lib/docs/load.test.ts` — slug resolution (bun test).

**Create — routes/shell:**
- `apps/web/src/app/docs/layout.tsx` — `surface-docs` shell (sidebar + content + TOC rail).
- `apps/web/src/app/docs/[[...slug]]/page.tsx` — catch-all renderer + `generateStaticParams` + `generateMetadata`.

**Create — chrome components:**
- `apps/web/src/components/docs/docs-sidebar.tsx`
- `apps/web/src/components/docs/toc-rail.tsx`
- `apps/web/src/components/docs/breadcrumb.tsx`
- `apps/web/src/components/docs/prev-next.tsx`

**Create — figure/prose components:**
- `apps/web/src/components/docs/flow-diagram.tsx`
- `apps/web/src/components/docs/harness-matrix.tsx`
- `apps/web/src/components/docs/system-map.tsx`
- `apps/web/src/components/docs/contract-card.tsx`
- `apps/web/src/components/docs/callout.tsx`
- `apps/web/src/components/docs/steps.tsx`
- `apps/web/src/components/docs/address-pill.tsx`

**Create — content (MDX):** under `apps/web/src/content/docs/<group>/<file>.mdx` (full list in Task 18).

**Modify:**
- `apps/web/package.json` — add the six docs deps.
- `apps/web/src/app/globals.css` — add `surface-docs` styles (appended).

---

## Stage 1 — Pipeline & shell

### Task 1: Add dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install the docs deps**

Run (from `apps/web`):

```bash
bun add next-mdx-remote@^5.0.0 shiki@^1.22.0 rehype-pretty-code@^0.14.0 remark-gfm@^4.0.0 rehype-slug@^6.0.0 gray-matter@^4.0.3
```

- [ ] **Step 2: Verify they landed in package.json**

Run: `grep -E "next-mdx-remote|shiki|rehype-pretty-code|remark-gfm|rehype-slug|gray-matter" package.json`
Expected: all six listed under `dependencies`.

- [ ] **Step 3: Typecheck still clean**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json bun.lock
git commit -m "build(web): add MDX docs pipeline deps"
```

---

### Task 2: Shared types

**Files:**
- Create: `apps/web/src/lib/docs/types.ts`

- [ ] **Step 1: Write the types**

```typescript
// apps/web/src/lib/docs/types.ts

/** One documentation page in the sidebar/nav. */
export interface DocPage {
  /** URL slug segments after /docs, e.g. ["protocol", "architecture"]. */
  slug: string[];
  /** Sidebar + <title> label. */
  title: string;
  /** Path to the MDX file relative to the content root, e.g. "protocol/architecture.mdx". */
  file: string;
}

/** A sidebar group containing ordered pages. */
export interface DocGroup {
  /** Group heading shown in the sidebar, e.g. "Protocol". */
  label: string;
  pages: DocPage[];
}

/** A heading extracted for the right-rail table of contents. */
export interface TocEntry {
  /** Heading text. */
  text: string;
  /** Slug id (matches rehype-slug output). */
  id: string;
  /** 2 for h2, 3 for h3. */
  depth: 2 | 3;
}

/** Result of loading a doc: frontmatter + raw MDX body. */
export interface LoadedDoc {
  title: string;
  description?: string;
  /** Raw MDX source (frontmatter stripped). */
  source: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/docs/types.ts
git commit -m "feat(docs): shared doc types"
```

---

### Task 3: Navigation config

**Files:**
- Create: `apps/web/src/lib/docs/docs-nav.ts`

- [ ] **Step 1: Write the nav config (the IA from the spec)**

```typescript
// apps/web/src/lib/docs/docs-nav.ts
import type { DocGroup, DocPage } from "./types";

/**
 * The docs information architecture — single source of truth for the sidebar,
 * static params, and prev/next. Every page here MUST have a matching MDX file
 * under src/content/docs/<file> (enforced by docs-nav.test.ts).
 *
 * The first page (introduction/overview) is the /docs landing page.
 */
export const DOCS_NAV: DocGroup[] = [
  {
    label: "Introduction",
    pages: [
      { slug: ["introduction", "overview"], title: "Overview", file: "introduction/overview.mdx" },
      { slug: ["introduction", "concepts"], title: "Concepts & glossary", file: "introduction/concepts.mdx" },
    ],
  },
  {
    label: "Protocol",
    pages: [
      { slug: ["protocol", "architecture"], title: "Architecture", file: "protocol/architecture.mdx" },
      { slug: ["protocol", "smart-contracts"], title: "Smart contracts", file: "protocol/smart-contracts.mdx" },
      { slug: ["protocol", "identity"], title: "ENS + ERC-8004 identity", file: "protocol/identity.mdx" },
      { slug: ["protocol", "sealed-inference"], title: "Sealed inference (TEE)", file: "protocol/sealed-inference.mdx" },
      { slug: ["protocol", "revenue"], title: "Revenue & payouts", file: "protocol/revenue.mdx" },
      { slug: ["protocol", "x402"], title: "x402 payment triangle", file: "protocol/x402.mdx" },
      { slug: ["protocol", "walrus"], title: "Walrus stateless storage", file: "protocol/walrus.mdx" },
    ],
  },
  {
    label: "The Harness",
    pages: [
      { slug: ["harness", "overview"], title: "Hermes overview", file: "harness/overview.mdx" },
      { slug: ["harness", "skills"], title: "Skills", file: "harness/skills.mdx" },
      { slug: ["harness", "memory"], title: "Three-layer memory", file: "harness/memory.mdx" },
      { slug: ["harness", "snapshots"], title: "Snapshot & restore", file: "harness/snapshots.mdx" },
      { slug: ["harness", "routing"], title: "Runtime × backend routing", file: "harness/routing.mdx" },
    ],
  },
  {
    label: "Flows",
    pages: [
      { slug: ["flows", "launch"], title: "Launch", file: "flows/launch.mdx" },
      { slug: ["flows", "money-loop"], title: "The money-loop", file: "flows/money-loop.mdx" },
      { slug: ["flows", "discovery"], title: "a2a discovery", file: "flows/discovery.mdx" },
      { slug: ["flows", "acquisition"], title: "Acquisition", file: "flows/acquisition.mdx" },
    ],
  },
  {
    label: "Build",
    pages: [
      { slug: ["build", "launch-an-agent"], title: "Launch an agent", file: "build/launch-an-agent.mdx" },
    ],
  },
];

/** Flat, ordered list of all pages (for prev/next + static params). */
export const ALL_DOC_PAGES: DocPage[] = DOCS_NAV.flatMap((g) => g.pages);

/** The landing page when the user hits /docs with no slug. */
export const DEFAULT_DOC = ALL_DOC_PAGES[0];

/** Find a page by its slug segments (joined with "/"). */
export function findDocBySlug(slug: string[]): DocPage | undefined {
  const key = slug.join("/");
  return ALL_DOC_PAGES.find((p) => p.slug.join("/") === key);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/docs/docs-nav.ts
git commit -m "feat(docs): navigation/IA config"
```

---

### Task 4: Loader (slug → frontmatter + source)

**Files:**
- Create: `apps/web/src/lib/docs/load.ts`
- Test: `apps/web/src/lib/docs/load.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/lib/docs/load.test.ts
import { test, expect } from "bun:test";
import { resolveDocFile } from "./load";
import { DEFAULT_DOC } from "./docs-nav";

test("empty slug resolves to the default doc file", () => {
  expect(resolveDocFile([])).toBe(DEFAULT_DOC.file);
});

test("known slug resolves to its file", () => {
  expect(resolveDocFile(["harness", "routing"])).toBe("harness/routing.mdx");
});

test("unknown slug resolves to undefined", () => {
  expect(resolveDocFile(["nope", "nope"])).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `bun test src/lib/docs/load.test.ts`
Expected: FAIL — `resolveDocFile` not exported.

- [ ] **Step 3: Write the loader**

```typescript
// apps/web/src/lib/docs/load.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { LoadedDoc } from "./types";
import { DEFAULT_DOC, findDocBySlug } from "./docs-nav";

/** Absolute path to the MDX content root. */
const CONTENT_ROOT = join(process.cwd(), "src", "content", "docs");

/** Resolve slug segments to a content-relative MDX file path, or undefined. */
export function resolveDocFile(slug: string[]): string | undefined {
  if (slug.length === 0) return DEFAULT_DOC.file;
  return findDocBySlug(slug)?.file;
}

/** Load + parse a doc by slug. Returns null if no matching page. */
export async function loadDoc(slug: string[]): Promise<LoadedDoc | null> {
  const file = resolveDocFile(slug);
  if (!file) return null;
  const raw = await readFile(join(CONTENT_ROOT, file), "utf8");
  const { content, data } = matter(raw);
  return {
    title: typeof data.title === "string" ? data.title : "Untitled",
    description: typeof data.description === "string" ? data.description : undefined,
    source: content,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/docs/load.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/docs/load.ts apps/web/src/lib/docs/load.test.ts
git commit -m "feat(docs): doc loader + slug resolution"
```

---

### Task 5: TOC extractor

**Files:**
- Create: `apps/web/src/lib/docs/toc.ts`
- Test: `apps/web/src/lib/docs/toc.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/lib/docs/toc.test.ts
import { test, expect } from "bun:test";
import { extractToc, slugifyHeading } from "./toc";

test("slugifyHeading matches rehype-slug style", () => {
  expect(slugifyHeading("The money-loop")).toBe("the-money-loop");
  expect(slugifyHeading("ENS + ERC-8004 identity")).toBe("ens--erc-8004-identity");
});

test("extractToc pulls h2 and h3 with ids and depth", () => {
  const src = [
    "# Title (ignored)",
    "",
    "## First section",
    "text",
    "### Sub point",
    "## Second section",
    "```ts",
    "## not a heading (in code fence)",
    "```",
  ].join("\n");
  expect(extractToc(src)).toEqual([
    { text: "First section", id: "first-section", depth: 2 },
    { text: "Sub point", id: "sub-point", depth: 3 },
    { text: "Second section", id: "second-section", depth: 2 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/docs/toc.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Write the extractor**

```typescript
// apps/web/src/lib/docs/toc.ts
import type { TocEntry } from "./types";

/**
 * Slugify a heading the same way rehype-slug (github-slugger) does for our
 * content: lowercase, strip chars that aren't word/space/hyphen, spaces→hyphens.
 * (github-slugger keeps a hyphen per space, so "a + b" → "a--b".)
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-");
}

/**
 * Extract h2/h3 headings from raw MDX source for the TOC rail.
 * Skips fenced code blocks so "## x" inside ``` isn't treated as a heading.
 */
export function extractToc(source: string): TocEntry[] {
  const out: TocEntry[] = [];
  let inFence = false;
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const depth = m[1].length as 2 | 3;
    const text = m[2].trim();
    out.push({ text, id: slugifyHeading(text), depth });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/docs/toc.test.ts`
Expected: PASS (2 tests).

> Note: `slugifyHeading` must stay consistent with the `rehype-slug` ids in rendered HTML so TOC anchor links work. If a heading with unusual punctuation ever mismatches, adjust this function — the test is the contract.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/docs/toc.ts apps/web/src/lib/docs/toc.test.ts
git commit -m "feat(docs): TOC heading extractor"
```

---

### Task 6: Nav↔file consistency test

**Files:**
- Create: `apps/web/src/lib/docs/docs-nav.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/src/lib/docs/docs-nav.test.ts
import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ALL_DOC_PAGES } from "./docs-nav";

const CONTENT_ROOT = join(process.cwd(), "src", "content", "docs");

test("every nav page has a matching MDX file", () => {
  const missing = ALL_DOC_PAGES.filter((p) => !existsSync(join(CONTENT_ROOT, p.file)));
  expect(missing.map((p) => p.file)).toEqual([]);
});

test("slugs are unique", () => {
  const keys = ALL_DOC_PAGES.map((p) => p.slug.join("/"));
  expect(new Set(keys).size).toBe(keys.length);
});
```

- [ ] **Step 2: Run it (expected to fail on missing files until content exists)**

Run: `bun test src/lib/docs/docs-nav.test.ts`
Expected: the first test FAILS listing all MDX files (none exist yet); the uniqueness test PASSES. This is the to-do list for Stage 3. Leave it red until Task 18.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/docs/docs-nav.test.ts
git commit -m "test(docs): nav↔file consistency + unique slugs"
```

---

### Task 7: MDX component map

**Files:**
- Create: `apps/web/src/lib/docs/mdx-components.tsx`

> This wires our bespoke components (built in Stage 2) into MDX. To avoid a broken import until they exist, this task registers only what exists now (none of the figures yet) and is updated in Task 17. For now it maps standard elements; figure components are added in Task 17.

- [ ] **Step 1: Write the initial map (standard elements only)**

```tsx
// apps/web/src/lib/docs/mdx-components.tsx
import type { MDXComponents } from "mdx/types";

/**
 * Component map injected into every MDX doc. Standard HTML elements get
 * surface-docs prose styling via globals.css (.surface-docs .prose ...), so we
 * only need to register custom tags here. Bespoke figures are added in Task 17.
 */
export const docsMdxComponents: MDXComponents = {};
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors. (If `mdx/types` is unresolved, it ships with `next-mdx-remote`'s peer `@types/mdx`; if missing, run `bun add -d @types/mdx` and re-run.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/docs/mdx-components.tsx
git commit -m "feat(docs): MDX component map (scaffold)"
```

---

### Task 8: Docs layout shell

**Files:**
- Create: `apps/web/src/app/docs/layout.tsx`
- Create: `apps/web/src/components/docs/docs-sidebar.tsx`

- [ ] **Step 1: Write the sidebar**

```tsx
// apps/web/src/components/docs/docs-sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/lib/docs/docs-nav";

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="docs-sidebar" aria-label="Documentation">
      {DOCS_NAV.map((group) => (
        <div key={group.label} className="docs-side-group">
          <p className="docs-side-label">{group.label}</p>
          <ul>
            {group.pages.map((page) => {
              const href = `/docs/${page.slug.join("/")}`;
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link href={href} className={active ? "active" : undefined}>
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write the layout shell**

```tsx
// apps/web/src/app/docs/layout.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="surface-docs">
      <header className="docs-topnav">
        <Link href="/" className="docs-brand">
          <Image src="/slopstock-glyph.png" alt="" width={22} height={22} />
          <span>slopstock</span>
          <span className="docs-brand-tag">docs</span>
        </Link>
        <nav className="docs-topnav-links">
          <Link href="/app">app</Link>
          <a href="https://github.com/forever8896/slopstock" target="_blank" rel="noreferrer">github</a>
        </nav>
      </header>
      <div className="docs-grid">
        <aside className="docs-aside">
          <DocsSidebar />
        </aside>
        <main className="docs-content">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/docs/layout.tsx apps/web/src/components/docs/docs-sidebar.tsx
git commit -m "feat(docs): layout shell + sidebar"
```

---

### Task 9: TOC rail + breadcrumb + prev/next

**Files:**
- Create: `apps/web/src/components/docs/toc-rail.tsx`
- Create: `apps/web/src/components/docs/breadcrumb.tsx`
- Create: `apps/web/src/components/docs/prev-next.tsx`

- [ ] **Step 1: Write the TOC rail**

```tsx
// apps/web/src/components/docs/toc-rail.tsx
import type { TocEntry } from "@/lib/docs/types";

export function TocRail({ entries }: { entries: TocEntry[] }) {
  if (entries.length === 0) return <aside className="docs-toc" aria-hidden />;
  return (
    <aside className="docs-toc" aria-label="On this page">
      <p className="docs-toc-label">On this page</p>
      <ul>
        {entries.map((e) => (
          <li key={e.id} className={e.depth === 3 ? "depth-3" : "depth-2"}>
            <a href={`#${e.id}`}>{e.text}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: Write the breadcrumb**

```tsx
// apps/web/src/components/docs/breadcrumb.tsx
import type { DocPage } from "@/lib/docs/types";

export function Breadcrumb({ group, page }: { group: string; page: DocPage }) {
  return (
    <p className="docs-crumb">
      <span>{group}</span>
      <span className="sep">/</span>
      <span className="cur">{page.title}</span>
    </p>
  );
}
```

- [ ] **Step 3: Write prev/next**

```tsx
// apps/web/src/components/docs/prev-next.tsx
import Link from "next/link";
import type { DocPage } from "@/lib/docs/types";

export function PrevNext({ prev, next }: { prev?: DocPage; next?: DocPage }) {
  return (
    <nav className="docs-prevnext" aria-label="Pager">
      {prev ? (
        <Link href={`/docs/${prev.slug.join("/")}`} className="pn prev">
          <span className="pn-dir">← Previous</span>
          <span className="pn-title">{prev.title}</span>
        </Link>
      ) : <span />}
      {next ? (
        <Link href={`/docs/${next.slug.join("/")}`} className="pn next">
          <span className="pn-dir">Next →</span>
          <span className="pn-title">{next.title}</span>
        </Link>
      ) : <span />}
    </nav>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/docs/toc-rail.tsx apps/web/src/components/docs/breadcrumb.tsx apps/web/src/components/docs/prev-next.tsx
git commit -m "feat(docs): TOC rail, breadcrumb, prev/next"
```

---

### Task 10: Catch-all renderer

**Files:**
- Create: `apps/web/src/app/docs/[[...slug]]/page.tsx`
- Create (temporary): `apps/web/src/content/docs/introduction/overview.mdx` (minimal, replaced in Task 18)

- [ ] **Step 1: Write a minimal Overview MDX so the route resolves**

```mdx
---
title: Overview
description: Slopstock protocol reference.
---

## Hello docs

This is a temporary overview page. Real content lands in Stage 3.

### A subheading

Body text for TOC verification.
```

Save as `apps/web/src/content/docs/introduction/overview.mdx`.

- [ ] **Step 2: Write the catch-all page**

```tsx
// apps/web/src/app/docs/[[...slug]]/page.tsx
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypePrettyCode from "rehype-pretty-code";
import { loadDoc } from "@/lib/docs/load";
import { extractToc } from "@/lib/docs/toc";
import { ALL_DOC_PAGES, DOCS_NAV, findDocBySlug, DEFAULT_DOC } from "@/lib/docs/docs-nav";
import { docsMdxComponents } from "@/lib/docs/mdx-components";
import { TocRail } from "@/components/docs/toc-rail";
import { Breadcrumb } from "@/components/docs/breadcrumb";
import { PrevNext } from "@/components/docs/prev-next";

export function generateStaticParams() {
  // Empty slug (/docs) + one per page.
  return [{ slug: [] as string[] }, ...ALL_DOC_PAGES.map((p) => ({ slug: p.slug }))];
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug?: string[] }> },
): Promise<Metadata> {
  const { slug = [] } = await params;
  const doc = await loadDoc(slug);
  if (!doc) return { title: "Not found — slopstock docs" };
  return {
    title: `${doc.title} — slopstock docs`,
    description: doc.description,
  };
}

const PRETTY_CODE_OPTS = { theme: "github-light", keepBackground: false } as const;

export default async function DocPage(
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug = [] } = await params;
  const doc = await loadDoc(slug);
  if (!doc) notFound();

  const page = slug.length === 0 ? DEFAULT_DOC : findDocBySlug(slug)!;
  const group = DOCS_NAV.find((g) => g.pages.some((p) => p === page))!;
  const flatIdx = ALL_DOC_PAGES.indexOf(page);
  const prev = flatIdx > 0 ? ALL_DOC_PAGES[flatIdx - 1] : undefined;
  const next = flatIdx < ALL_DOC_PAGES.length - 1 ? ALL_DOC_PAGES[flatIdx + 1] : undefined;

  const toc = extractToc(doc.source);
  const { content } = await compileMDX({
    source: doc.source,
    components: docsMdxComponents,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeSlug, [rehypePrettyCode, PRETTY_CODE_OPTS]],
      },
    },
  });

  return (
    <div className="docs-page">
      <article className="docs-article prose">
        <Breadcrumb group={group.label} page={page} />
        <h1 className="docs-title">{doc.title}</h1>
        {doc.description ? <p className="docs-lead">{doc.description}</p> : null}
        {content}
        <PrevNext prev={prev} next={next} />
      </article>
      <TocRail entries={toc} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the dev server and verify the route**

Run (from `apps/web`): `bun run dev` then open `http://localhost:3000/docs`.
Expected: Overview renders with sidebar (all groups), breadcrumb "Introduction / Overview", the h2/h3, and a right-rail TOC with "Hello docs" + "A subheading". `http://localhost:3000/docs/harness/routing` → 404 (no file yet). Stop the server.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/docs/[[...slug]]/page.tsx apps/web/src/content/docs/introduction/overview.mdx
git commit -m "feat(docs): catch-all MDX renderer + temp overview"
```

---

### Task 11: surface-docs base styles

**Files:**
- Modify: `apps/web/src/app/globals.css` (append a `surface-docs` block)

- [ ] **Step 1: Append the docs styles**

Append to the end of `apps/web/src/app/globals.css`:

```css
/* ─── Docs surface ────────────────────────────────────────────────── */
.surface-docs { display: flex; flex-direction: column; min-height: 100vh; }

.docs-topnav {
  display: flex; align-items: center; justify-content: space-between;
  height: 60px; padding: 0 28px; border-bottom: 1px solid var(--hair);
  background: rgba(248, 244, 237, 0.85); backdrop-filter: blur(8px);
  position: sticky; top: 0; z-index: 50;
}
.docs-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; font-size: 17px; color: var(--fg); }
.docs-brand img { width: 22px; height: 22px; object-fit: contain; }
.docs-brand-tag { font-family: var(--font-mono), monospace; font-size: 12px; color: var(--accent); font-weight: 600; }
.docs-topnav-links { display: flex; gap: 18px; font-size: 14px; }
.docs-topnav-links a { color: var(--fg-2); }
.docs-topnav-links a:hover { color: var(--accent); }

.docs-grid {
  display: grid; grid-template-columns: 248px minmax(0, 1fr);
  max-width: 1320px; margin: 0 auto; width: 100%; flex: 1;
}
.docs-aside {
  position: sticky; top: 60px; align-self: start; height: calc(100vh - 60px);
  overflow-y: auto; padding: 28px 18px 40px; border-right: 1px solid var(--hair);
}
.docs-content { min-width: 0; padding: 0; }

/* sidebar */
.docs-side-group { margin-bottom: 22px; }
.docs-side-label {
  font-family: var(--font-mono), monospace; font-size: 12px; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--mute); margin: 0 0 8px; padding-left: 10px;
}
.docs-sidebar ul { list-style: none; margin: 0; padding: 0; }
.docs-sidebar li a {
  display: block; padding: 6px 10px; border-radius: var(--radius-sm);
  font-size: 14.5px; color: var(--fg-2); line-height: 1.35;
}
.docs-sidebar li a:hover { background: #fff; color: var(--fg); }
.docs-sidebar li a.active {
  background: var(--accent-tint); color: var(--accent); font-weight: 600;
}

/* page = article + toc */
.docs-page { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 40px; padding: 40px 44px 80px; }
.docs-article { min-width: 0; max-width: 760px; }

.docs-crumb { font-family: var(--font-mono), monospace; font-size: 13px; color: var(--mute); margin: 0 0 14px; }
.docs-crumb .sep { margin: 0 7px; opacity: 0.5; }
.docs-crumb .cur { color: var(--accent); }
.docs-title { font-family: var(--font-serif); font-weight: 400; font-size: clamp(32px, 4vw, 46px); line-height: 1.06; letter-spacing: -0.02em; color: #14161b; margin: 0 0 14px; }
.docs-lead { font-size: 19px; line-height: 1.6; color: var(--fg-2); margin: 0 0 36px; }

/* prose rhythm */
.prose h2 { font-family: var(--font-serif); font-weight: 500; font-size: 28px; line-height: 1.15; color: #14161b; margin: 48px 0 16px; scroll-margin-top: 78px; }
.prose h3 { font-family: var(--font-serif); font-weight: 500; font-size: 21px; color: #14161b; margin: 32px 0 12px; scroll-margin-top: 78px; }
.prose p { font-size: 16.5px; line-height: 1.72; color: var(--fg-2); margin: 0 0 18px; }
.prose ul, .prose ol { font-size: 16.5px; line-height: 1.7; color: var(--fg-2); margin: 0 0 18px; padding-left: 22px; }
.prose li { margin: 0 0 6px; }
.prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.prose a:hover { color: var(--accent-hover); }
.prose strong { color: var(--fg); font-weight: 650; }
.prose code {
  font-family: var(--font-mono), monospace; font-size: 0.88em;
  background: var(--accent-tint); color: #1a2b6b; padding: 1.5px 5px; border-radius: 5px;
}
.prose pre {
  background: #fbfaf7; border: 1px solid var(--hair); border-radius: var(--radius);
  padding: 16px 18px; overflow-x: auto; margin: 0 0 22px; font-size: 13.5px; line-height: 1.6;
}
.prose pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
.prose table { width: 100%; border-collapse: collapse; margin: 0 0 22px; font-size: 14.5px; }
.prose th, .prose td { border: 1px solid var(--hair); padding: 8px 12px; text-align: left; vertical-align: top; }
.prose th { background: var(--accent-tint); font-weight: 650; color: var(--fg); }
.prose blockquote { border-left: 3px solid var(--accent-dim); padding: 2px 0 2px 16px; margin: 0 0 18px; color: var(--mute); }

/* toc rail */
.docs-toc { position: sticky; top: 84px; align-self: start; max-height: calc(100vh - 110px); overflow-y: auto; }
.docs-toc-label { font-family: var(--font-mono), monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mute); margin: 0 0 10px; }
.docs-toc ul { list-style: none; margin: 0; padding: 0; }
.docs-toc li { margin: 0 0 6px; }
.docs-toc li.depth-3 { padding-left: 12px; }
.docs-toc a { font-size: 13.5px; color: var(--fg-2); line-height: 1.4; }
.docs-toc a:hover { color: var(--accent); }

/* prev/next */
.docs-prevnext { display: flex; justify-content: space-between; gap: 16px; margin-top: 56px; padding-top: 28px; border-top: 1px solid var(--hair); }
.docs-prevnext .pn { display: flex; flex-direction: column; gap: 4px; padding: 14px 18px; border: 1px solid var(--hair); border-radius: var(--radius); flex: 1; color: inherit; }
.docs-prevnext .pn:hover { border-color: var(--accent-dim); background: #fff; }
.docs-prevnext .pn.next { text-align: right; align-items: flex-end; }
.docs-prevnext .pn-dir { font-family: var(--font-mono), monospace; font-size: 12px; color: var(--mute); }
.docs-prevnext .pn-title { font-weight: 600; color: var(--fg); font-size: 15px; }

@media (max-width: 1080px) {
  .docs-page { grid-template-columns: minmax(0, 1fr); }
  .docs-toc { display: none; }
}
@media (max-width: 820px) {
  .docs-grid { grid-template-columns: 1fr; }
  .docs-aside { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--hair); }
  .docs-page { padding: 28px 20px 64px; }
}
```

- [ ] **Step 2: Run the dev server and verify styling**

Run: `bun run dev`, open `http://localhost:3000/docs`.
Expected: two-column shell (sidebar + content), styled prose, sticky TOC on the right at wide widths; sidebar collapses above content under 820px; TOC hidden under 1080px. Active sidebar link highlighted. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(docs): surface-docs styles (shell, prose, toc)"
```

---

## Stage 2 — Bespoke component library

> Each component is a presentational Server Component. After each, verify by temporarily using it in `introduction/overview.mdx` (you'll replace that file in Task 18). Styles for all figures are added in Task 16 (one CSS block), but each task appends its own styles incrementally so the component is verifiable immediately.

### Task 12: Callout, Steps, AddressPill

**Files:**
- Create: `apps/web/src/components/docs/callout.tsx`
- Create: `apps/web/src/components/docs/steps.tsx`
- Create: `apps/web/src/components/docs/address-pill.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write Callout**

```tsx
// apps/web/src/components/docs/callout.tsx
import type { ReactNode } from "react";

type Variant = "note" | "warn" | "onchain";
const GLYPH: Record<Variant, string> = { note: "▌", warn: "▲", onchain: "⛓" };

export function Callout({ variant = "note", title, children }: { variant?: Variant; title?: string; children: ReactNode }) {
  return (
    <div className={`docs-callout ${variant}`}>
      <span className="docs-callout-glyph" aria-hidden>{GLYPH[variant]}</span>
      <div className="docs-callout-body">
        {title ? <p className="docs-callout-title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write Steps/Step**

```tsx
// apps/web/src/components/docs/steps.tsx
import type { ReactNode } from "react";

export function Steps({ children }: { children: ReactNode }) {
  return <div className="docs-steps">{children}</div>;
}

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="docs-step">
      <span className="docs-step-n">{String(n).padStart(2, "0")}</span>
      <div className="docs-step-body">
        <p className="docs-step-title">{title}</p>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write AddressPill**

```tsx
// apps/web/src/components/docs/address-pill.tsx
type Kind = "base" | "eth" | "ens" | "none";

const BASE: Record<Kind, (v: string) => string | undefined> = {
  base: (v) => `https://basescan.org/address/${v}`,
  eth: (v) => `https://etherscan.io/address/${v}`,
  ens: (v) => `https://app.ens.domains/${v}`,
  none: () => undefined,
};

export function AddressPill({ value, kind = "base", label }: { value: string; kind?: Kind; label?: string }) {
  const href = BASE[kind](value);
  const text = label ?? value;
  if (!href) return <span className="docs-addr">{text}</span>;
  return (
    <a className="docs-addr" href={href} target="_blank" rel="noreferrer">{text}</a>
  );
}
```

- [ ] **Step 4: Append styles to globals.css**

```css
/* docs: callouts */
.docs-callout { display: flex; gap: 12px; padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--hair); margin: 0 0 22px; background: var(--panel); }
.docs-callout-glyph { font-family: var(--font-mono), monospace; line-height: 1.6; }
.docs-callout-body p { margin: 0 0 8px; }
.docs-callout-body p:last-child { margin: 0; }
.docs-callout-title { font-weight: 650; color: var(--fg); }
.docs-callout.note { border-color: var(--accent-dim); background: var(--accent-tint); }
.docs-callout.note .docs-callout-glyph { color: var(--accent); }
.docs-callout.warn { border-color: #e7b54d; background: #fff8ea; }
.docs-callout.warn .docs-callout-glyph { color: #b9791a; }
.docs-callout.onchain { border-color: var(--hair); background: #fbfaf7; }
.docs-callout.onchain .docs-callout-glyph { color: var(--accent); }

/* docs: steps */
.docs-steps { display: flex; flex-direction: column; gap: 0; margin: 0 0 24px; border-left: 1px solid var(--hair); padding-left: 4px; }
.docs-step { display: flex; gap: 14px; padding: 6px 0 18px 14px; position: relative; }
.docs-step-n { font-family: var(--font-mono), monospace; font-size: 12px; font-weight: 700; color: var(--accent); background: var(--accent-tint); border: 1px solid var(--accent-dim); border-radius: 8px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.docs-step-title { font-weight: 650; color: var(--fg); margin: 6px 0 6px; }
.docs-step-body p { margin: 0 0 8px; }

/* docs: address pill */
.docs-addr { font-family: var(--font-mono), monospace; font-size: 0.86em; background: #fbfaf7; border: 1px solid var(--hair); border-radius: 6px; padding: 1px 6px; color: var(--accent); text-decoration: none; }
.docs-addr:hover { border-color: var(--accent-dim); }
```

- [ ] **Step 5: Typecheck + visual check**

Run: `bun run typecheck` (expect clean). Then temporarily add to `introduction/overview.mdx` after registering in Task 17 — for now, just typecheck. Visual verification happens in Task 17 once they're in the MDX map.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/docs/callout.tsx apps/web/src/components/docs/steps.tsx apps/web/src/components/docs/address-pill.tsx apps/web/src/app/globals.css
git commit -m "feat(docs): callout, steps, address-pill components"
```

---

### Task 13: FlowDiagram

**Files:**
- Create: `apps/web/src/components/docs/flow-diagram.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/components/docs/flow-diagram.tsx

/**
 * Declarative lane/step flow diagram — the designed successor to the ASCII
 * flows. Lanes are the actors (columns/legend); each step is an ordered action
 * with an originating lane and an optional target lane. Renders as a vertical
 * sequence of numbered rows with from→to actor chips, which reads well on both
 * desktop and mobile (no SVG layout math required).
 */
export interface FlowStep {
  /** Index of the acting lane (0-based, into `lanes`). */
  from: number;
  /** Index of the target lane, if this step crosses to another actor. */
  to?: number;
  /** What happens. */
  action: string;
  /** Optional on-chain / payload annotation (mono). */
  note?: string;
}

export function FlowDiagram({ title, lanes, steps }: { title?: string; lanes: string[]; steps: FlowStep[] }) {
  return (
    <figure className="docs-flow">
      {title ? <figcaption className="docs-flow-title">{title}</figcaption> : null}
      <div className="docs-flow-lanes">
        {lanes.map((l, i) => (
          <span key={l} className="docs-flow-lane" data-lane={i}>{l}</span>
        ))}
      </div>
      <ol className="docs-flow-steps">
        {steps.map((s, i) => (
          <li key={i} className="docs-flow-step">
            <span className="docs-flow-num">{i + 1}</span>
            <div className="docs-flow-main">
              <div className="docs-flow-actors">
                <span className="docs-flow-chip">{lanes[s.from]}</span>
                {s.to !== undefined ? (
                  <>
                    <span className="docs-flow-arrow" aria-hidden>→</span>
                    <span className="docs-flow-chip">{lanes[s.to]}</span>
                  </>
                ) : null}
              </div>
              <p className="docs-flow-action">{s.action}</p>
              {s.note ? <p className="docs-flow-note">{s.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}
```

- [ ] **Step 2: Append styles**

```css
/* docs: flow diagram */
.docs-flow { margin: 0 0 28px; border: 1px solid var(--hair); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
.docs-flow-title { font-family: var(--font-mono), monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mute); padding: 12px 18px; border-bottom: 1px solid var(--hair); background: #fbfaf7; }
.docs-flow-lanes { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--hair); }
.docs-flow-lane { font-family: var(--font-mono), monospace; font-size: 12px; color: var(--fg-2); background: var(--accent-tint); border: 1px solid var(--accent-dim); border-radius: 6px; padding: 2px 8px; }
.docs-flow-steps { list-style: none; margin: 0; padding: 0; }
.docs-flow-step { display: flex; gap: 14px; padding: 14px 18px; border-bottom: 1px solid var(--hair); }
.docs-flow-step:last-child { border-bottom: none; }
.docs-flow-num { font-family: var(--font-mono), monospace; font-size: 12px; font-weight: 700; color: var(--accent); width: 26px; height: 26px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--accent-dim); border-radius: 7px; background: var(--accent-tint); }
.docs-flow-main { min-width: 0; }
.docs-flow-actors { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.docs-flow-chip { font-family: var(--font-mono), monospace; font-size: 12px; font-weight: 600; color: var(--fg); }
.docs-flow-arrow { color: var(--accent); }
.docs-flow-action { font-size: 15px; line-height: 1.55; color: var(--fg-2); margin: 0; }
.docs-flow-note { font-family: var(--font-mono), monospace; font-size: 12.5px; color: var(--mute); margin: 4px 0 0; }
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/docs/flow-diagram.tsx apps/web/src/app/globals.css
git commit -m "feat(docs): FlowDiagram component"
```

---

### Task 14: HarnessMatrix

**Files:**
- Create: `apps/web/src/components/docs/harness-matrix.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/components/docs/harness-matrix.tsx

/**
 * The runtime × backend routing matrix. Rows = runtime (the layer above the LLM
 * call); columns = compute backend (where the call physically goes). Each cell
 * describes the resulting behavior. Source of truth: apps/operator/src/runtime/index.ts.
 */
const RUNTIMES = [
  { key: "hermes", label: "hermes", blurb: "stateful loop · tools · skills · memory" },
  { key: "openai-compat", label: "openai-compat", blurb: "single-shot LLM call, stateless" },
];
const BACKENDS = [
  { key: "0g-compute", label: "0g-compute", blurb: "sealed, TEE-attested (Intel TDX / H100/H200)" },
  { key: "openai-compat", label: "openai-compat", blurb: "any OpenAI-shaped HTTP endpoint" },
];
const CELLS: Record<string, string> = {
  "hermes|0g-compute": "Full harness on sealed inference — the production path for launched agents (deepseek-v4 on 0G mainnet).",
  "hermes|openai-compat": "Full harness on a plain endpoint — local/dev (Ollama, OpenRouter). Stateful, unsealed.",
  "openai-compat|0g-compute": "One sealed call, no state — cheap attested inference without the agent loop.",
  "openai-compat|openai-compat": "One plain call — the simplest baseline.",
};

export function HarnessMatrix() {
  return (
    <figure className="docs-matrix">
      <div className="docs-matrix-grid">
        <div className="docs-matrix-corner">runtime ↓ / backend →</div>
        {BACKENDS.map((b) => (
          <div key={b.key} className="docs-matrix-head">
            <span className="docs-matrix-key">{b.label}</span>
            <span className="docs-matrix-blurb">{b.blurb}</span>
          </div>
        ))}
        {RUNTIMES.map((r) => (
          <FragmentRow key={r.key} rLabel={r.label} rBlurb={r.blurb} rKey={r.key} />
        ))}
      </div>
      <figcaption className="docs-matrix-cap">
        Selection per tokenId: <code>RUNTIME_BY_TOKEN_ID</code> → <code>AGENT_RUNTIME</code> →
        {" "}<code>BACKEND_BY_TOKEN_ID</code> → <code>COMPUTE_BACKEND</code>. Launched agents always route to hermes on 0g-compute.
      </figcaption>
    </figure>
  );
}

function FragmentRow({ rLabel, rBlurb, rKey }: { rLabel: string; rBlurb: string; rKey: string }) {
  return (
    <>
      <div className="docs-matrix-head row">
        <span className="docs-matrix-key">{rLabel}</span>
        <span className="docs-matrix-blurb">{rBlurb}</span>
      </div>
      {BACKENDS.map((b) => (
        <div key={b.key} className={`docs-matrix-cell ${rKey === "hermes" && b.key === "0g-compute" ? "primary" : ""}`}>
          {CELLS[`${rKey}|${b.key}`]}
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Append styles**

```css
/* docs: harness matrix */
.docs-matrix { margin: 0 0 28px; }
.docs-matrix-grid { display: grid; grid-template-columns: 0.9fr 1fr 1fr; border: 1px solid var(--hair); border-radius: var(--radius); overflow: hidden; }
.docs-matrix-grid > * { border-right: 1px solid var(--hair); border-bottom: 1px solid var(--hair); padding: 12px 14px; }
.docs-matrix-grid > *:nth-child(3n) { border-right: none; }
.docs-matrix-corner { font-family: var(--font-mono), monospace; font-size: 11.5px; color: var(--mute); background: #fbfaf7; }
.docs-matrix-head { display: flex; flex-direction: column; gap: 3px; background: var(--accent-tint); }
.docs-matrix-head.row { background: #fbfaf7; }
.docs-matrix-key { font-family: var(--font-mono), monospace; font-size: 13px; font-weight: 700; color: var(--accent); }
.docs-matrix-blurb { font-size: 12px; color: var(--mute); line-height: 1.4; }
.docs-matrix-cell { font-size: 13.5px; line-height: 1.5; color: var(--fg-2); }
.docs-matrix-cell.primary { background: rgba(26,77,255,0.05); color: var(--fg); font-weight: 500; }
.docs-matrix-cap { font-size: 13px; color: var(--mute); margin-top: 10px; line-height: 1.55; }
.docs-matrix-cap code { font-size: 0.9em; }
@media (max-width: 720px) {
  .docs-matrix-grid { grid-template-columns: 1fr; }
  .docs-matrix-grid > * { border-right: none; }
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/docs/harness-matrix.tsx apps/web/src/app/globals.css
git commit -m "feat(docs): HarnessMatrix component"
```

---

### Task 15: SystemMap + ContractCard

**Files:**
- Create: `apps/web/src/components/docs/system-map.tsx`
- Create: `apps/web/src/components/docs/contract-card.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write SystemMap**

```tsx
// apps/web/src/components/docs/system-map.tsx

/**
 * Top-level architecture map as labelled layers. Each layer is a band with a
 * role label and the components living in it. Declarative so content MDX can
 * tune it; defaults reflect the current stack.
 */
export interface MapLayer {
  role: string;
  nodes: string[];
}

const DEFAULT_LAYERS: MapLayer[] = [
  { role: "Surfaces", nodes: ["Landing", "App (exchange)", "Docs"] },
  { role: "Identity", nodes: ["ENS (L1)", "ERC-8004 registry (Base)", "ENSIP-25 verify"] },
  { role: "Settlement", nodes: ["Base mainnet", "x402 v2", "USDC (EIP-3009)"] },
  { role: "Compute", nodes: ["Operator node", "Hermes harness", "0G compute (sealed TEE)"] },
  { role: "Storage", nodes: ["Walrus blobs", "Seal (threshold IBE)", "ENS agent-snapshot pointer"] },
];

export function SystemMap({ layers = DEFAULT_LAYERS }: { layers?: MapLayer[] }) {
  return (
    <figure className="docs-sysmap">
      {layers.map((layer) => (
        <div key={layer.role} className="docs-sysmap-layer">
          <span className="docs-sysmap-role">{layer.role}</span>
          <div className="docs-sysmap-nodes">
            {layer.nodes.map((n) => (
              <span key={n} className="docs-sysmap-node">{n}</span>
            ))}
          </div>
        </div>
      ))}
    </figure>
  );
}
```

- [ ] **Step 2: Write ContractCard**

```tsx
// apps/web/src/components/docs/contract-card.tsx
import { AddressPill } from "./address-pill";

export function ContractCard({ name, chain, responsibility, address, addrKind = "base" }: {
  name: string;
  chain: string;
  responsibility: string;
  address?: string;
  addrKind?: "base" | "eth" | "ens" | "none";
}) {
  return (
    <div className="docs-contract">
      <div className="docs-contract-head">
        <span className="docs-contract-name">{name}</span>
        <span className="docs-contract-chain">{chain}</span>
      </div>
      <p className="docs-contract-resp">{responsibility}</p>
      {address ? <AddressPill value={address} kind={addrKind} /> : null}
    </div>
  );
}
```

- [ ] **Step 3: Append styles**

```css
/* docs: system map */
.docs-sysmap { margin: 0 0 28px; display: flex; flex-direction: column; gap: 8px; }
.docs-sysmap-layer { display: grid; grid-template-columns: 120px 1fr; gap: 14px; align-items: center; border: 1px solid var(--hair); border-radius: var(--radius); padding: 12px 16px; background: var(--panel); }
.docs-sysmap-role { font-family: var(--font-mono), monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }
.docs-sysmap-nodes { display: flex; flex-wrap: wrap; gap: 8px; }
.docs-sysmap-node { font-size: 13.5px; color: var(--fg); background: #fbfaf7; border: 1px solid var(--hair); border-radius: 6px; padding: 4px 10px; }

/* docs: contract card */
.docs-contract { border: 1px solid var(--hair); border-radius: var(--radius); padding: 16px 18px; margin: 0 0 14px; background: var(--panel); }
.docs-contract-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.docs-contract-name { font-family: var(--font-mono), monospace; font-weight: 700; font-size: 15px; color: var(--fg); }
.docs-contract-chain { font-family: var(--font-mono), monospace; font-size: 12px; color: var(--accent); background: var(--accent-tint); border-radius: 5px; padding: 1px 7px; }
.docs-contract-resp { font-size: 14.5px; line-height: 1.55; color: var(--fg-2); margin: 0 0 10px; }
@media (max-width: 620px) { .docs-sysmap-layer { grid-template-columns: 1fr; gap: 8px; } }
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/docs/system-map.tsx apps/web/src/components/docs/contract-card.tsx apps/web/src/app/globals.css
git commit -m "feat(docs): SystemMap + ContractCard components"
```

---

### Task 16: (Reserved) — styles consolidation check

> Styles were added incrementally per component, so there is no separate consolidation file. This task is a verification gate, not new code.

- [ ] **Step 1: Confirm no duplicate selectors**

Run (from repo root): `grep -c "docs-flow-step" apps/web/src/app/globals.css`
Expected: small count (selectors defined once). If any figure selector appears in two blocks, merge them.

- [ ] **Step 2: Typecheck**

Run (from `apps/web`): `bun run typecheck`
Expected: no errors.

(No commit unless a merge was needed; if so: `git commit -am "style(docs): dedupe figure selectors"`.)

---

### Task 17: Register components in the MDX map + smoke them

**Files:**
- Modify: `apps/web/src/lib/docs/mdx-components.tsx`
- Modify (temporary): `apps/web/src/content/docs/introduction/overview.mdx`

- [ ] **Step 1: Fill in the component map**

```tsx
// apps/web/src/lib/docs/mdx-components.tsx
import type { MDXComponents } from "mdx/types";
import { Callout } from "@/components/docs/callout";
import { Steps, Step } from "@/components/docs/steps";
import { AddressPill } from "@/components/docs/address-pill";
import { FlowDiagram } from "@/components/docs/flow-diagram";
import { HarnessMatrix } from "@/components/docs/harness-matrix";
import { SystemMap } from "@/components/docs/system-map";
import { ContractCard } from "@/components/docs/contract-card";

export const docsMdxComponents: MDXComponents = {
  Callout,
  Steps,
  Step,
  AddressPill,
  FlowDiagram,
  HarnessMatrix,
  SystemMap,
  ContractCard,
};
```

- [ ] **Step 2: Exercise every component in overview.mdx (temporary)**

Replace `introduction/overview.mdx` body with one usage of each (this proves the wiring; Task 18 writes the real page):

```mdx
---
title: Overview
description: Component smoke test (temporary).
---

## Callouts

<Callout variant="note" title="Note">A note callout.</Callout>
<Callout variant="warn" title="Warning">A warning callout.</Callout>
<Callout variant="onchain" title="On-chain">An on-chain callout with <AddressPill value="0x22dc3880000000000000000000000000000000000" kind="base" label="settle tx" />.</Callout>

## System map

<SystemMap />

## Harness matrix

<HarnessMatrix />

## A flow

<FlowDiagram
  title="example flow"
  lanes={["user", "operator", "0G compute"]}
  steps={[
    { from: 0, to: 1, action: "POST /infer with x402 payment", note: "USDC on Base" },
    { from: 1, to: 2, action: "run sealed inference", note: "TEE-attested" },
    { from: 2, to: 0, action: "return signed receipt" },
  ]}
/>

## A contract

<ContractCard name="RevenueVault.sol" chain="Base" responsibility="Holds USDC, snapshots holders, distributes pro-rata." />

## Steps

<Steps>
  <Step n={1} title="First">Do the first thing.</Step>
  <Step n={2} title="Second">Then the second.</Step>
</Steps>
```

- [ ] **Step 3: Typecheck + run dev server**

Run: `bun run typecheck` (expect clean). Then `bun run dev`, open `http://localhost:3000/docs`.
Expected: every component renders styled — callouts (3 variants), system map (5 layers), harness matrix (2×2 with the hermes|0g-compute cell highlighted), the flow diagram (3 numbered steps with actor chips), the contract card, and the steps. TOC lists all the h2s. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/docs/mdx-components.tsx apps/web/src/content/docs/introduction/overview.mdx
git commit -m "feat(docs): wire bespoke components into MDX + smoke page"
```

---

## Stage 3 — Content

> Content is real writing work (spec §8): rewrite from the cited current-stack sources into public-facing prose. Do **not** copy the old 0G/Stratum PRDs verbatim — reconcile against `docs/nyc-2026/MASTERPLAN.md` first. Each page below lists its frontmatter, required figures, section skeleton (the h2/h3 that drive the TOC), and source files to draft from. Author the prose at execution with those sources open. After each page, view it on the dev server.

**Source reading list (read before authoring):** `docs/nyc-2026/MASTERPLAN.md`, `docs/01-architecture.md`, `docs/02-smart-contracts.md`, `docs/nyc-2026/02-ens-erc8004.md`, `docs/03-sealed-inference.md`, `docs/nyc-2026/03-walrus.md`, `docs/nyc-2026/05-x402-v2.md`, `docs/nyc-2026/06-revenue-and-economics.md`, `docs/08-hero-agent.md`, `docs/nyc-2026/08-hermes-fidelity.md`, `docs/12-real-agent-launch.md`, `apps/operator/src/runtime/index.ts`, `apps/operator/src/runtime/hermes.ts`, `apps/operator/src/runtime/skills.ts`, `apps/operator/src/runtime/hermes-loop.ts`, `apps/operator/src/storage/snapshot.ts`, the `docs/superpowers/plans/2026-06-13-walrus-stateless-operator.md`.

### Task 18: Author all content pages

**Files (create each):**

For each page: create the MDX file with the given frontmatter (`title`, `description`), write the listed sections as `##`/`###` headings, and use the listed figures. Verify on the dev server, then commit per the grouping below.

**Introduction**

- `introduction/overview.mdx` (replace the smoke page) — *frontmatter:* title "Overview", description "What Slopstock is and why agents are productive property." *Sections:* `## The thesis` · `## How it works` · `## What makes it unusual` · `## Where to go next`. *Figures:* `SystemMap`, one `FlowDiagram` (the money-loop, abbreviated). *Sources:* README, marketing page, MASTERPLAN north-star.
- `introduction/concepts.mdx` — *frontmatter:* "Concepts & glossary". *Sections:* `## Agent as property` · `## Identity` · `## Inference & trust` · `## Money` · `## The harness` · `## Storage`. Under each, define terms (iNFT/ERC-7857, share token, RevenueVault, IPO, TEE attestation, x402, ENSIP-25/26, ERC-8004, Seal, Walrus, snapshot pointer, Hermes, skill, bundle hash) — use `**term** — definition` list items. *Figures:* none.

- [ ] Author both Introduction pages, verify, commit:
```bash
git add apps/web/src/content/docs/introduction/
git commit -m "docs(content): introduction — overview + concepts"
```

**Protocol**

- `protocol/architecture.mdx` — "Architecture". `## System map` (use `SystemMap`) · `## Chains & where things live` (Base vs ETH L1 vs Walrus/Sui) · `## Components` (operator, gateway, indexer, web) · `## Trust model` (table). *Sources:* `01-architecture.md` modernized to current stack, MASTERPLAN.
- `protocol/smart-contracts.mdx` — "Smart contracts". `## Agent NFT (ERC-7857)` · `## Share token (ERC-20)` · `## RevenueVault` · `## IPO sale` · `## Marketplace` · `## Registry`. Use `ContractCard` per contract. *Sources:* `02-smart-contracts.md`, `contracts/src/*`.
- `protocol/identity.mdx` — "ENS + ERC-8004 identity". `## ENS names` · `## ENSIP-26 records` · `## ERC-8004 registration` · `## ENSIP-25 verification` · `## Live on mainnet` (mention `auditor.slopstock.eth` #55228, `oracles.slopstock.eth` #55229, use `AddressPill kind="ens"`). *Sources:* `nyc-2026/02-ens-erc8004.md`, MASTERPLAN row 02.
- `protocol/sealed-inference.mdx` — "Sealed inference (TEE)". `## Why sealed` · `## How attestation works` · `## The signed receipt` · `## Verifying a receipt`. Use a `Callout variant="onchain"`. *Sources:* `03-sealed-inference.md`, `08-hermes-fidelity.md`.
- `protocol/revenue.mdx` — "Revenue & payouts". `## Per-call revenue` · `## The vault` · `## Pro-rata distribution` · `## Self-funding (LI.FI bridge)`. Use one `FlowDiagram` (distribution). *Sources:* `04-revenue-and-payments.md`, `nyc-2026/06-revenue-and-economics.md`.
- `protocol/x402.mdx` — "x402 payment triangle". `## Inbound` · `## Outbound` · `## Internal (a2a)` · `## Why a triangle`. Use a `FlowDiagram` of one payment. *Sources:* `nyc-2026/05-x402-v2.md`.
- `protocol/walrus.mdx` — "Walrus stateless storage". `## The problem (stateful operator)` · `## Brain → Walrus` · `## Seal encryption` · `## The ENS snapshot pointer` · `## Amnesia & cold-boot`. Use a `FlowDiagram` (snapshot/restore). *Sources:* `nyc-2026/03-walrus.md`, walrus-stateless-operator plan, `snapshot.ts`.

- [ ] Author all Protocol pages, verify each, commit:
```bash
git add apps/web/src/content/docs/protocol/
git commit -m "docs(content): protocol pages"
```

**The Harness**

- `harness/overview.mdx` — "Hermes overview". `## What the harness is` · `## Hermes-pattern (honest framing)` · `## The task loop` · `## On-disk layout`. *Callout (note):* "Hermes-**pattern**, not literally running Hermes." *Sources:* `hermes.ts` header, `hermes-loop.ts`, `08-hermes-fidelity.md`.
- `harness/skills.mdx` — "Skills". `## Skill format` · `## Progressive disclosure` · `## Self-authoring (skill_manage)` · `## In-place improvement`. *Sources:* `skills.ts`, `08-hermes-fidelity.md`.
- `harness/memory.mdx` — "Three-layer memory". `## Layer 0 — working` · `## Layer 1 — files (MEMORY.md / USER.md)` · `## Layer 2 — SQLite FTS5` · `## Reload per task`. *Sources:* `08-hermes-fidelity.md`, `memory-files.ts`.
- `harness/snapshots.mdx` — "Snapshot & restore". `## Bundle hash` · `## Snapshot to Walrus` · `## Restore from ENS pointer` · `## Receipts fold-in`. Use a `FlowDiagram`. *Sources:* `snapshot.ts`, walrus-stateless-operator plan, `bundle.ts`.
- `harness/routing.mdx` — "Runtime × backend routing". `## Two orthogonal axes` · `## The matrix` (use `HarnessMatrix`) · `## Selection precedence` · `## Launched agents`. *Sources:* `runtime/index.ts`.

- [ ] Author all Harness pages, verify each, commit:
```bash
git add apps/web/src/content/docs/harness/
git commit -m "docs(content): harness pages"
```

**Flows** (each is primarily one `FlowDiagram` + prose)

- `flows/launch.mdx` — "Launch". Mint iNFT → fractionalize shares → register ENS+ERC-8004 → seed Hermes on 0g-v4. `## Overview` · `## Step by step` (FlowDiagram) · `## What you get`. *Sources:* `01-architecture.md` §3.1, launch-rework plan, `12-real-agent-launch.md`.
- `flows/money-loop.mdx` — "The money-loop". x402 pay → sealed infer → signed receipt → vault → snapshot → shareholder paid. `## Overview` · `## The loop` (FlowDiagram) · `## Proven end-to-end` (mention `smoke-e2e-full-loop.ts`). *Sources:* `01-architecture.md` §3.3.
- `flows/discovery.mdx` — "a2a discovery". ENS discover → ENSIP-25 verify → x402 pay peer. `## Overview` · `## Discovery & verification` (FlowDiagram) · `## Forgery rejection`. *Sources:* `nyc-2026/02-ens-erc8004.md`, `query_agent`.
- `flows/acquisition.mdx` — "Acquisition". Whole-iNFT buyout with TEE re-encryption. `## Overview` · `## Bid & re-encrypt` (FlowDiagram) · `## Shares vs the agent` (note shares aren't auto-transferred). *Callout (warn):* design/planned vs live status. *Sources:* `01-architecture.md` §3.5.

- [ ] Author all Flows pages, verify each, commit:
```bash
git add apps/web/src/content/docs/flows/
git commit -m "docs(content): flow pages"
```

**Build**

- `build/launch-an-agent.mdx` — "Launch an agent" (guide voice). `## Before you start` · `## 1. Define the agent` · `## 2. Mint & fractionalize` · `## 3. Register identity` · `## 4. Price & list` · `## 5. Verify it works`. Use `Steps`/`Step`. *Sources:* `12-real-agent-launch.md`, launch-rework plan, `apps/web/src/components/launch-flow.tsx` for current UI reality.

- [ ] Author the Build page, verify, commit:
```bash
git add apps/web/src/content/docs/build/
git commit -m "docs(content): build — launch an agent guide"
```

---

### Task 19: Full verification pass

- [ ] **Step 1: All tests green**

Run (from `apps/web`): `bun test src/lib/docs/`
Expected: PASS — including `docs-nav.test.ts` (every page now has a file) and unique slugs.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `bun run build`
Expected: build succeeds; all `/docs/*` routes statically generated (one per `ALL_DOC_PAGES` + `/docs`).

- [ ] **Step 4: Manual route + acceptance sweep**

Run: `bun run start`, then check:
- `/docs` → Overview; sidebar shows all 5 groups in order; active link highlighted.
- Click through every sidebar page → renders with breadcrumb + TOC + prev/next.
- `/docs/harness/routing` → HarnessMatrix renders, hermes|0g-compute cell highlighted.
- A flow page → FlowDiagram renders; `/docs/protocol/architecture` → SystemMap; `/docs/protocol/smart-contracts` → ContractCards.
- A code block highlights (Shiki); a table renders; internal doc links resolve.
- `/docs/does/not/exist` → 404.
- DevTools Network on `/docs`: no wagmi/rainbowkit/wallet chunk loaded.
- Resize to mobile: sidebar stacks above content (<820px), TOC hidden (<1080px), HarnessMatrix + FlowDiagram reflow to single column.

- [ ] **Step 5: Confirm content is current-stack, not 0G**

Run (from repo root): `grep -rinE "0G Chain|AXL|KeeperHub|stratum\.eth|galileo" apps/web/src/content/docs/ || echo "clean"`
Expected: `clean` (or only intentional historical mentions). The published docs describe Base · ENS/ERC-8004 · Walrus · Seal · x402 · Hermes.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A apps/web
git commit -m "docs: verification pass fixes"
```

---

## Self-review (completed during planning)

**Spec coverage:** §2 decisions → Tasks 1,7,10 (MDX mechanism), Task 18 (current-stack content), Task 3 (IA), Tasks 8/9 (nav). §3.1 tree → Tasks 2–10. §3.3 components → Tasks 12–15, 17. §3.4 styling → Task 11 + per-component. §4 deps → Task 1. §5 IA/content → Tasks 3, 18. §6 acceptance → Task 19. §7 out-of-scope → respected (no search/dark-mode/backend). §8 risks → flagged in Stage 3 preamble + Task 19 step 5 (stale-source trap) + bundle check (Task 19 step 4). §9 sequencing → the three stages.

**Placeholder scan:** No "TBD/TODO/handle edge cases" in code steps. Content prose in Task 18 is intentionally authored-at-execution (a writing task, not code) but every page has explicit frontmatter, section skeleton, required figures, and exact sources — not "fill in details."

**Type consistency:** `DocPage`/`DocGroup`/`TocEntry`/`LoadedDoc` (Task 2) used consistently across `docs-nav.ts`, `load.ts`, `toc.ts`, components. `resolveDocFile`/`loadDoc` (Task 4), `extractToc`/`slugifyHeading` (Task 5), `docsMdxComponents` (Tasks 7→17), `FlowStep`/`MapLayer` props match their consumers. `findDocBySlug`/`DEFAULT_DOC`/`ALL_DOC_PAGES` defined in Task 3 and used in Tasks 4 and 10.
