// apps/web/src/components/docs/callout.tsx
import type { ReactNode } from "react";

type Variant = "note" | "warn" | "onchain";
const GLYPH: Record<Variant, string> = { note: "▌", warn: "▲", onchain: "⛓" };

export function Callout({ variant = "note", title, children }: { variant?: Variant; title?: string; children: ReactNode }) {
  return (
    <div className={`docs-callout ${variant}`}>
      <span className="docs-callout-glyph" aria-hidden>{GLYPH[variant]}</span>
      <div className="docs-callout-body">
        {title ? <p className="docs-callout-title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
