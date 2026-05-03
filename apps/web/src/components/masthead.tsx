"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/", label: "markets", match: (p) => p === "/" || p.startsWith("/agent/") },
  { href: "/launch", label: "launch agent", match: (p) => p.startsWith("/launch") },
];

export function Masthead() {
  const pathname = usePathname();
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href="/" className="brand" aria-label="slopstock home">
          <span className="mark">
            <Image
              src="/slopstock-logo.png"
              alt=""
              width={28}
              height={28}
              priority
            />
          </span>
          <span className="word">slopstock</span>
          <span className="proto">stratum protocol · v0.3</span>
        </Link>

        <nav className="topnav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={n.match(pathname) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
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
