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
