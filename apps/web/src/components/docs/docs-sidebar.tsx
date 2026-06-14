"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/lib/docs/docs-nav";

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="docs-sidebar" aria-label="Documentation">
      {DOCS_NAV.map((group) => (
        <div key={group.label} className="docs-side-group">
          <p className="docs-side-label">{group.label}</p>
          <ul>
            {group.pages.map((page) => {
              const href = `/docs/${page.slug.join("/")}`;
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link href={href} className={active ? "active" : undefined}>
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
