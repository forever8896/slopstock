/**
 * Small, dependency-free helpers for the register handler. Kept separate from
 * server.ts so they're unit-testable without pulling the whole operator graph
 * (chain clients, @mysten/seal, etc.).
 */

/** A tool credential to provision into 1Claw at launch. */
export interface LaunchCredential {
  ref: string;
  value: string;
}

/** Parse + validate the optional `credentials` array from a register body.
 *  Drops entries with a blank ref or value; trims the ref. Never throws on bad
 *  shape — unknown input just yields []. */
export function parseCredentials(raw: unknown): LaunchCredential[] {
  if (!Array.isArray(raw)) return [];
  const out: LaunchCredential[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const ref = (item as { ref?: unknown }).ref;
    const value = (item as { value?: unknown }).value;
    if (typeof ref === "string" && ref.trim() && typeof value === "string" && value.length > 0) {
      out.push({ ref: ref.trim(), value });
    }
  }
  return out;
}
