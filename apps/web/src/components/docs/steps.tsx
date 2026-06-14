// apps/web/src/components/docs/steps.tsx
import type { ReactNode } from "react";

export function Steps({ children }: { children: ReactNode }) {
  return <div className="docs-steps">{children}</div>;
}

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="docs-step">
      <span className="docs-step-n">{String(n).padStart(2, "0")}</span>
      <div className="docs-step-body">
        <p className="docs-step-title">{title}</p>
        {children}
      </div>
    </div>
  );
}
