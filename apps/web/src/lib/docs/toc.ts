// apps/web/src/lib/docs/toc.ts
import GithubSlugger from "github-slugger";
import type { TocEntry } from "./types";

/**
 * Slugify a single heading the same way rehype-slug does (it uses
 * github-slugger under the hood). This is the single-shot form: a fresh
 * slugger per call, so it does NOT dedup across calls. For a whole document
 * (where repeated headings must get `-1`, `-2`, …) use `extractToc`, which
 * keeps one stateful slugger for the document.
 *
 * github-slugger lowercases, keeps Unicode letters/numbers, drops most
 * punctuation, and turns each space into a hyphen — so "a + b" → "a--b"
 * and "über café" → "über-café".
 */
export function slugifyHeading(text: string): string {
  return new GithubSlugger().slug(text);
}

/**
 * Extract h2/h3 headings from raw MDX source for the TOC rail.
 * Skips fenced code blocks (``` and ~~~) so "## x" inside a fence isn't
 * treated as a heading. Ids are generated with a single stateful
 * github-slugger instance per document, so they match rehype-slug's anchor
 * ids exactly — including the `-1`/`-2`/… suffixes on duplicate headings.
 */
export function extractToc(source: string): TocEntry[] {
  const out: TocEntry[] = [];
  const slugger = new GithubSlugger();
  let inFence = false;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    // Both capture groups are guaranteed present when `m` is non-null.
    const depth = m[1]!.length as 2 | 3;
    // Strip an optional trailing closed-ATX hash run: "## Heading ##" → "Heading".
    const text = m[2]!.replace(/\s+#+\s*$/, "").trim();
    out.push({ text, id: slugger.slug(text), depth });
  }
  return out;
}
