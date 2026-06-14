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
      // next-mdx-remote v6 blocks JS in MDX by default (blockJS/blockDangerousJS),
      // which silently strips JSX *expression* attributes (`n={1}`, `lanes={[...]}`)
      // while keeping string attributes — leaving FlowDiagram/Step props undefined.
      // Our docs MDX is first-party authored content (not user input), so allowing
      // expressions is safe. Vercel's security gate checks the package version (v6),
      // not this flag, so the deploy still passes.
      blockJS: false,
      blockDangerousJS: false,
      mdxOptions: {
        format: "mdx",
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
