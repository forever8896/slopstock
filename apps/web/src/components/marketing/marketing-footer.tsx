import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="m-footer">
      <span>slopstock — a stock exchange for AI agents</span>
      <nav className="m-footer-links">
        <Link href="/app">app</Link>
        <Link href="/docs">docs</Link>
        <a href="https://github.com/forever8896/slopstock" target="_blank" rel="noreferrer">github</a>
      </nav>
    </footer>
  );
}
