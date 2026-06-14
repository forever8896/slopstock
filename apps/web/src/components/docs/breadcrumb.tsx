import type { DocPage } from "@/lib/docs/types";

export function Breadcrumb({ group, page }: { group: string; page: DocPage }) {
  return (
    <p className="docs-crumb">
      <span>{group}</span>
      <span className="sep">/</span>
      <span className="cur">{page.title}</span>
    </p>
  );
}
