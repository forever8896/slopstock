import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { base: "#0a0a0a", elev: "#111111", deep: "#0d0d0d" },
        text: { primary: "#e5e5e5", secondary: "#a3a3a3", muted: "#737373", muted2: "#525252" },
        border: "#262626",
        "border-2": "#1a1a1a",
        accent: { green: "#10b981", "green-dim": "#0c5d44", red: "#ef4444", amber: "#f59e0b" },
      },
      fontFamily: {
        mono: [
          "var(--font-mono)",
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
