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
