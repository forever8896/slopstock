import type { Config } from "tailwindcss";

/**
 * Stratum theme. Bloomberg-terminal aesthetic — see docs/07-frontend.md §6.
 *
 *   bg.base      #0a0a0a   page
 *   bg.elev      #111111   cards, panels
 *   text.primary #e5e5e5   body
 *   text.muted   #737373   metadata, axis labels
 *   border       #262626   1px hairlines
 *   accent.green #10b981   verified, paid, received
 *   accent.red   #ef4444   failed, expired
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { base: "#0a0a0a", elev: "#111111" },
        text: { primary: "#e5e5e5", muted: "#737373" },
        border: "#262626",
        accent: { green: "#10b981", red: "#ef4444" },
      },
      fontFamily: {
        // System mono stack — picks up JetBrains Mono / Fira Code / SF Mono if installed.
        mono: [
          '"JetBrains Mono"',
          '"IBM Plex Mono"',
          '"Fira Code"',
          '"SF Mono"',
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
