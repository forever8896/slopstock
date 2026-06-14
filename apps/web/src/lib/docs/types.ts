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
