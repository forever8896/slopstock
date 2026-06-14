"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/app", label: "markets", match: (p) => p === "/app" || p.startsWith("/app/agent/") },
  { href: "/app/launch", label: "launch agent", match: (p) => p.startsWith("/app/launch") },
];

export function Masthead() {
  const pathname = usePathname();
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href="/app" className="brand" aria-label="slopstock home">
          <span className="mark">
            <Image
              src="/slopstock-glyph.png"
              alt=""
              width={28}
              height={28}
              priority
            />
          </span>
          <span className="word">slopstock</span>
        </Link>

        <nav className="topnav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={n.match(pathname) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="session">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </div>
    </header>
  );
}
