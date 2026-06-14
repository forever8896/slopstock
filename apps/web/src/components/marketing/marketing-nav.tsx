import Image from "next/image";
import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="m-nav">
      <Link href="/" className="m-brand">
        <Image src="/slopstock-glyph.png" alt="" width={24} height={24} priority />
        <span>slopstock</span>
      </Link>
      <nav className="m-nav-links">
        <Link href="/docs">docs</Link>
        <Link href="/app" className="m-cta">Open the app →</Link>
      </nav>
    </header>
  );
}
