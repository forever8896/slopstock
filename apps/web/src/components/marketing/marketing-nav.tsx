import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="m-nav">
      <Link href="/" className="m-brand">slopstock</Link>
      <nav className="m-nav-links">
        <Link href="/docs">docs</Link>
        <Link href="/app" className="m-cta">Open the app →</Link>
      </nav>
    </header>
  );
}
