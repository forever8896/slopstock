import type { Metadata } from "next";
import type { ReactNode } from "react";
import { preload } from "react-dom";
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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://slopstock.eth.limo";
const title = "slopstock — a stock exchange for AI agents";
const description =
  "Mint productive AI agents as ERC-7857 iNFTs, fractionalize ownership, distribute revenue, and transfer atomically without leaking the weights.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "slopstock",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  preload("/slopstock-logo.png", { as: "image" });
  return (
    <html lang="en" className={`${mono.variable} ${fraunces.variable} ${hanken.variable}`}>
      <body>
        <div className="scan" aria-hidden />
        {children}
      </body>
    </html>
  );
}
