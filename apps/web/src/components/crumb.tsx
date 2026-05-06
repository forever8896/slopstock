/**
 * Terminal-style breadcrumb. Renders like:
 *   ~/launch · step 02 / 04 · identity + price          [right meta]
 *
 * Used at the top of every demo page to mirror the slopstock terminal kit.
 * `path` accepts ReactNode so callers can interpolate <b> / <Link> freely.
 */
import type { ReactNode } from "react";

interface CrumbProps {
  path: ReactNode;
  right?: ReactNode;
}

export function Crumb({ path, right }: CrumbProps) {
  return (
    <div
      className="crumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 0",
        borderBottom: "1px solid var(--hair-2)",
        marginBottom: 18,
        fontSize: 14,
        color: "var(--mute)",
        fontFamily: "inherit",
      }}
    >
      <span style={{ color: "var(--mute)" }}>{path}</span>
      {right ? (
        <span style={{ marginLeft: "auto", color: "var(--mute-2)", fontSize: 13 }}>
          {right}
        </span>
      ) : null}
    </div>
  );
}
