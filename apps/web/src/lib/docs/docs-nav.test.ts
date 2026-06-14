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
