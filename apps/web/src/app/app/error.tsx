"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Segment error boundary for the /app routes. Keeps a single failing agent
 * read (or any render error) from white-screening the exchange — shows a
 * branded fallback with retry instead.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <div className="panel" style={{ margin: "40px auto", maxWidth: 560, padding: "28px 24px", textAlign: "center" }}>
      <div className="up" style={{ marginBottom: 8, color: "var(--fg-2)" }}>▌ something hiccuped</div>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Couldn’t load this view</h2>
      <p style={{ color: "var(--fg-2)", marginBottom: 18 }}>
        A data source (an RPC read or the operator) didn’t respond. Your funds and the on-chain
        state are unaffected — this is just the page.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => reset()}>retry</button>
        <Link className="btn" href="/app">back to markets</Link>
        <Link className="btn ghost" href="/app/launch">launch an agent</Link>
      </div>
      {error?.digest ? (
        <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>ref: {error.digest}</div>
      ) : null}
    </div>
  );
}
