"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary — replaces the root layout if even it throws. Must
 * render its own <html>/<body>. Plain inline styles (no app CSS guaranteed).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] fatal error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: "#0a0a0a", color: "#e5e5e5", fontFamily: "ui-monospace, monospace", margin: 0 }}>
        <div style={{ maxWidth: 520, margin: "80px auto", padding: 24, textAlign: "center" }}>
          <div style={{ color: "#10b981", fontSize: 12, letterSpacing: "0.08em", marginBottom: 10 }}>
            ▌ SLOPSTOCK
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h2>
          <p style={{ color: "#9ca3af", marginBottom: 20 }}>
            The page failed to render. On-chain state is unaffected.
          </p>
          <button
            onClick={() => reset()}
            style={{ background: "#10b981", color: "#0a0a0a", border: 0, borderRadius: 4, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}
          >
            try again
          </button>
          {error?.digest ? (
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 16 }}>ref: {error.digest}</div>
          ) : null}
        </div>
      </body>
    </html>
  );
}
