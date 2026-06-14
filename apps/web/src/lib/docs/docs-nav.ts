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
