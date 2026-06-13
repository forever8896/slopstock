import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="surface-marketing">
      <MarketingNav />
      <main className="m-main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
