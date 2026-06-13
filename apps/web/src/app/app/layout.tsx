import type { ReactNode } from "react";
import { Masthead } from "@/components/masthead";
import { TickerTape } from "@/components/ticker-tape";
import { Providers } from "@/app/providers";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="surface-app">
      <Providers>
        <Masthead />
        <TickerTape />
        <main className="page">{children}</main>
      </Providers>
    </div>
  );
}
