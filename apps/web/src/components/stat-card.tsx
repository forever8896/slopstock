import type { ReactNode } from "react";

interface Row {
  label: string;
  value: ReactNode;
  hint?: string;
}

export function StatCard({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="panel p-4">
      <div className="label mb-3">{title}</div>
      <dl className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-text-muted">{r.label}</dt>
            <dd className="text-right text-sm">
              {r.value}
              {r.hint ? <div className="text-xs text-text-muted">{r.hint}</div> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
