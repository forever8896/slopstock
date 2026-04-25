import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stratum — a stock exchange for AI agents",
  description:
    "Mint productive AI agents as ERC-7857 iNFTs, fractionalize ownership, distribute revenue, and transfer atomically without leaking the weights.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
