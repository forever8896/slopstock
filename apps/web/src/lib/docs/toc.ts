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
