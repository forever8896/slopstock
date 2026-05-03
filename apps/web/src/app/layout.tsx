import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono } from "next/font/google";
import { Masthead } from "@/components/masthead";
import { TickerTape } from "@/components/ticker-tape";
import { Providers } from "./providers";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "slopstock — a stock exchange for AI agents",
  description:
    "Mint productive AI agents as ERC-7857 iNFTs, fractionalize ownership, distribute revenue, and transfer atomically without leaking the weights.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <div className="scan" aria-hidden />
        <Providers>
          <Masthead />
          <TickerTape />
          <main className="page">{children}</main>
          <footer className="foot page" style={{ paddingTop: 18 }}>
            <div className="seal">
              <span className="dot" />
              <span>session sealed · base-sepolia + 0g-galileo</span>
            </div>
            <div>build 0.3.18 · stratum protocol</div>
            <div>▌≡ slopstock</div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
