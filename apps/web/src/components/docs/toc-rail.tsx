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
