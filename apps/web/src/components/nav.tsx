"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";

export function Nav() {
  return (
    <nav className="border-b border-border bg-bg-base">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/app" className="flex items-center gap-2 text-sm">
          <span className="text-accent-green">▌</span>
          <span className="font-semibold tracking-wide">stratum</span>
        </Link>

        <div className="flex items-center gap-6 text-sm">
          <Link href="/app" className="text-text-muted hover:text-text-primary">
            markets
          </Link>
          <Link href="/operator" className="text-text-muted hover:text-text-primary">
            operator
          </Link>
          <Link href="/about" className="text-text-muted hover:text-text-primary">
            about
          </Link>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </div>
    </nav>
  );
}
