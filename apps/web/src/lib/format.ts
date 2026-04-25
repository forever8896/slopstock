/**
 * Display formatters. All inputs are wei-shaped bigints; outputs are strings
 * suitable for direct rendering. Keep this file pure — no React, no hooks.
 */

export function shortAddr(addr: string, chars = 4): string {
  if (!addr.startsWith("0x")) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

/**
 * Format a wei-shaped bigint with up to `frac` fractional digits, with optional
 * thousand separators. Trims trailing zeros.
 */
export function formatUnits(value: bigint, decimals: number, frac = 4): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  let fractionStr = fraction.toString().padStart(decimals, "0").slice(0, frac);
  fractionStr = fractionStr.replace(/0+$/, "");

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const result = fractionStr.length > 0 ? `${wholeStr}.${fractionStr}` : wholeStr;
  return negative ? `-${result}` : result;
}

/** USDC = 6 decimals. */
export const formatUsdc = (v: bigint, frac = 2) => formatUnits(v, 6, frac);

/** Shares = 18 decimals. */
export const formatShares = (v: bigint, frac = 0) => formatUnits(v, 18, frac);

/**
 * Render percentage from bigints (numerator / denominator) with `frac` digits.
 * Avoids floating-point drift on share splits.
 */
export function pctOf(num: bigint, den: bigint, frac = 1): string {
  if (den === 0n) return "0%";
  // pct = num / den * 100 → keep precision via 10^(frac+2)
  const scale = 10n ** BigInt(frac + 2);
  const scaled = (num * scale) / den;
  const whole = scaled / 10n ** BigInt(frac);
  const fraction = scaled % 10n ** BigInt(frac);
  if (frac === 0) return `${whole}%`;
  return `${whole}.${fraction.toString().padStart(frac, "0")}%`;
}

export function relativeTime(unixSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, now - unixSec);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}
