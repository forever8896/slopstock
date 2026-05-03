"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/", label: "markets", match: (p) => p === "/" },
  { href: "/agent/AUDIT", label: "agents", match: (p) => p.startsWith("/agent/") && !p.endsWith("/subscribe") && !p.endsWith("/acquire") },
  { href: "/agent/AUDIT/subscribe", label: "subscribe", match: (p) => p.endsWith("/subscribe") },
  { href: "/agent/AUDIT/acquire", label: "acquire", match: (p) => p.endsWith("/acquire") },
];

export function Masthead() {
  const pathname = usePathname();
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href="/" className="brand">
          <span className="mark"><span>▌≡</span></span>
          <span className="word">slopstock</span>
          <span className="proto">stratum protocol · v0.3</span>
        </Link>

        <nav className="topnav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={n.match(pathname) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
          <a href="#" className="muted">docs</a>
        </nav>

        <div className="session">
          <span className="dot" />
          <span>base-sepolia · 0g-galileo</span>
          <Clock />
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </div>
    </header>
  );
}

function Clock() {
  const [t, setT] = useState("--:--:-- UTC");
  useEffect(() => {
    function tick() {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setT(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="clock">{t}</span>;
}
