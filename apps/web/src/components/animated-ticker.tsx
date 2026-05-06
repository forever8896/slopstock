"use client";

/**
 * Big block-letter ticker rendered as ASCII art, with two animations:
 *
 *   1. Decode-on-mount — each char starts as a random rune from a pool of
 *      unicode block / box / brand glyphs and settles to its real letter
 *      over ~1 second, staggered per position. Matrix-decode vibe.
 *
 *   2. Continuous scanline + faint CRT — handled in CSS (.ticker-art::before
 *      sweeps a green gradient bar; .ticker-art::after lays down 1px scanlines).
 *
 * Block alphabet: 5 rows tall, 5 cols wide per glyph, separated by 1-col gap.
 * Covers A–Z, 0–9, space, and a `?` fallback for everything else.
 *
 * One typed prop:  <AnimatedTicker ticker="ORCH" />
 */

import { useEffect, useRef, useState } from "react";

const FONT: Record<string, string[]> = {
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  B: ["████ ", "█   █", "████ ", "█   █", "████ "],
  C: [" ████", "█    ", "█    ", "█    ", " ████"],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  E: ["█████", "█    ", "███  ", "█    ", "█████"],
  F: ["█████", "█    ", "███  ", "█    ", "█    "],
  G: [" ████", "█    ", "█  ██", "█   █", " ████"],
  H: ["█   █", "█   █", "█████", "█   █", "█   █"],
  I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
  J: ["█████", "   █ ", "   █ ", "█  █ ", " ██  "],
  K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  Q: [" ███ ", "█   █", "█ █ █", "█  ██", " ████"],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  S: [" ████", "█    ", " ███ ", "    █", "████ "],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
  X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
  Z: ["█████", "   █ ", "  █  ", " █   ", "█████"],
  "0": [" ███ ", "█  ██", "█ █ █", "██  █", " ███ "],
  "1": ["  █  ", " ██  ", "  █  ", "  █  ", " ███ "],
  "2": [" ███ ", "█   █", "   █ ", "  █  ", "█████"],
  "3": ["████ ", "    █", " ███ ", "    █", "████ "],
  "4": ["█   █", "█   █", "█████", "    █", "    █"],
  "5": ["█████", "█    ", "████ ", "    █", "████ "],
  "6": [" ███ ", "█    ", "████ ", "█   █", " ███ "],
  "7": ["█████", "    █", "   █ ", "  █  ", " █   "],
  "8": [" ███ ", "█   █", " ███ ", "█   █", " ███ "],
  "9": [" ███ ", "█   █", " ████", "    █", " ███ "],
  " ": ["     ", "     ", "     ", "     ", "     "],
  "?": [" ███ ", "█   █", "   █ ", "  █  ", "  █  "],
};

const DECODE_POOL = "█▓▒░▌▐▀▄■□◆◇▲▼◣◢◤◥◧◨#$@%&*+=";

function glyphFor(ch: string): string[] {
  return FONT[ch] ?? FONT["?"]!;
}

function renderBlock(chars: string[]): string {
  const rows: string[] = ["", "", "", "", ""];
  for (let ci = 0; ci < chars.length; ci++) {
    const g = glyphFor(chars[ci]!);
    for (let r = 0; r < 5; r++) {
      rows[r] = (rows[r] ?? "") + (g[r] ?? "     ");
      if (ci < chars.length - 1) rows[r] = (rows[r] ?? "") + " ";
    }
  }
  return rows.join("\n");
}

function randomRune(): string {
  return DECODE_POOL[Math.floor(Math.random() * DECODE_POOL.length)]!;
}

interface Props {
  ticker: string;
  /** Optional caption shown below the block. */
  sub?: string;
}

export function AnimatedTicker({ ticker, sub }: Props) {
  const target = ticker.toUpperCase().split("");
  const [chars, setChars] = useState<string[]>(() =>
    target.map(() => randomRune()),
  );
  const ref = useRef<HTMLPreElement>(null);

  // Matrix-style decode-on-mount.
  useEffect(() => {
    let frame = 0;
    const STAGGER = 4; // frames between settlements (per char)
    const SETTLE_OFFSET = 8;
    const FRAME_MS = 50;
    const id = setInterval(() => {
      frame++;
      setChars(
        target.map((c, i) => {
          const settleAt = SETTLE_OFFSET + i * STAGGER;
          if (frame >= settleAt) return c;
          return randomRune();
        }),
      );
      if (frame > SETTLE_OFFSET + target.length * STAGGER + 4) {
        clearInterval(id);
      }
    }, FRAME_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  return (
    <div className="ticker-art">
      <pre ref={ref}>{renderBlock(chars)}</pre>
      {sub ? <div className="ticker-sub">{sub}</div> : null}
    </div>
  );
}
