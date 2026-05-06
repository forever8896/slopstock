/**
 * Renders an agent's final-answer JSON with two demo affordances:
 *   1. Tx hashes (0x + 64 hex) become clickable Basescan links.
 *   2. If the JSON shape matches the cross-agent-orchestrator schema
 *      ({answer, peers[], totalPaid}), peers are rendered as a structured
 *      list with explicit "paid X USDC to Y, see tx →" links.
 *
 * Falls back to a plain <pre> with hash auto-linking for any other shape.
 */

import { Fragment, type ReactNode } from "react";

const TX_HASH_RE = /0x[a-fA-F0-9]{64}/g;

function basescanTxUrl(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

interface PeerEntry {
  agent?: string;
  input?: string;
  output?: string;
  txHash?: string;
}

interface OrchestratorShape {
  answer?: string;
  peers?: PeerEntry[];
  totalPaid?: string;
}

function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isOrchestratorShape(v: unknown): v is OrchestratorShape {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o["peers"]);
}

/** Linkify any 0x...64-hex substrings in a chunk of text. */
function linkifyHashes(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  text.replace(TX_HASH_RE, (match, offset: number) => {
    if (offset > last) out.push(text.slice(last, offset));
    out.push(
      <a
        key={`${offset}-${match}`}
        href={basescanTxUrl(match)}
        target="_blank"
        rel="noreferrer"
        className="acc"
        style={{ textDecoration: "underline" }}
      >
        {match.slice(0, 10)}…
      </a>,
    );
    last = offset + match.length;
    return match;
  });
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function InferenceOutput({ raw }: { raw: string }) {
  const parsed = tryParseJson(raw);

  if (isOrchestratorShape(parsed)) {
    const o = parsed;
    return (
      <div
        style={{
          background: "#0a0a0a",
          border: "1px solid var(--hair-2)",
          borderRadius: 4,
          padding: 14,
          fontSize: 12,
          color: "var(--fg-2)",
        }}
      >
        {o.answer ? (
          <div style={{ marginBottom: 12 }}>
            <div className="up" style={{ marginBottom: 4 }}>answer</div>
            <div style={{ color: "var(--fg)" }}>{o.answer}</div>
          </div>
        ) : null}
        {o.peers && o.peers.length > 0 ? (
          <div style={{ marginBottom: 8 }}>
            <div className="up" style={{ marginBottom: 6 }}>
              peers paid · {o.peers.length} call{o.peers.length === 1 ? "" : "s"}
            </div>
            {o.peers.map((p, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 8,
                  paddingLeft: 12,
                  borderLeft: "2px solid rgba(16,185,129,0.4)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                  <b className="acc">{p.agent ?? "unknown agent"}</b>
                  {p.txHash ? (
                    <a
                      href={basescanTxUrl(p.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="acc"
                      style={{ textDecoration: "underline", fontSize: 11 }}
                    >
                      see payment on basescan ↗
                    </a>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>(no txHash)</span>
                  )}
                </div>
                {p.input ? (
                  <div className="muted" style={{ marginTop: 2, fontSize: 11 }}>
                    asked: <i>{p.input.length > 220 ? p.input.slice(0, 220) + "…" : p.input}</i>
                  </div>
                ) : null}
                {p.output && p.output.trim().length > 0 && p.output.trim() !== "(empty)" ? (
                  <div
                    style={{
                      marginTop: 4,
                      whiteSpace: "pre-wrap",
                      padding: "6px 8px",
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 3,
                      fontSize: 11,
                    }}
                  >
                    {p.output}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 4, fontSize: 11, fontStyle: "italic" }}>
                    (peer response captured in answer above; see basescan tx for the on-chain settlement)
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {o.totalPaid ? (
          <div className="muted" style={{ fontSize: 11 }}>
            total paid this call: <span className="acc">${o.totalPaid} USDC</span>
          </div>
        ) : null}
      </div>
    );
  }

  // Fallback: render the raw string in a <pre>, but auto-link any tx hashes.
  return (
    <pre
      style={{
        marginTop: 0,
        padding: 10,
        background: "#0a0a0a",
        border: "1px solid var(--hair-2)",
        color: "var(--fg-2)",
        fontSize: 12,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        margin: 0,
      }}
    >
      {linkifyHashes(raw).map((chunk, i) => (
        <Fragment key={i}>{chunk}</Fragment>
      ))}
    </pre>
  );
}
