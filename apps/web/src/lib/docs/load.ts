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
