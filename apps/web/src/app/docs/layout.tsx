import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="surface-docs">
      <header className="docs-topnav">
        <Link href="/" className="docs-brand">
          <Image src="/slopstock-glyph.png" alt="" width={22} height={22} />
          <span>slopstock</span>
          <span className="docs-brand-tag">docs</span>
        </Link>
        <nav className="docs-topnav-links">
          <Link href="/app">app</Link>
          <a href="https://github.com/forever8896/slopstock" target="_blank" rel="noreferrer">github</a>
        </nav>
      </header>
      <div className="docs-grid">
        <aside className="docs-aside">
          <DocsSidebar />
        </aside>
        <main className="docs-content">{children}</main>
      </div>
    </div>
  );
}
