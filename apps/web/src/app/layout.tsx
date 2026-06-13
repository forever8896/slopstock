import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "slopstock — a stock exchange for AI agents",
  description:
    "Mint productive AI agents as ERC-7857 iNFTs, fractionalize ownership, distribute revenue, and transfer atomically without leaking the weights.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${fraunces.variable} ${hanken.variable}`}>
      <body>
        <div className="scan" aria-hidden />
        {children}
      </body>
    </html>
  );
}
