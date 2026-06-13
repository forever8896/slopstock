# Phase 1 — Structural Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `apps/web` so the marketing landing owns `/`, the product app moves under `/app/*` with its own chrome + wallet providers, and the root layout becomes a minimal shell — with airtight redirects so existing links keep working.

**Architecture:** Next.js App Router route groups in a single app. A `(marketing)` route group serves `/` with marketing chrome; a real `app/` segment serves `/app/*` with the masthead, ticker, and wagmi providers; the root layout keeps only `<html>`/`<body>`, fonts, and global CSS. Product pages move wholesale; their relative imports are converted to the `@/` alias so the deeper nesting doesn't break them.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind 3, bun, wagmi/RainbowKit, Playwright (visual verification).

---

## Conventions for this plan

- **No git commits.** Per the project's no-commit-during-demo-prep preference, tasks end with a **verification checkpoint**, not a commit. `git mv` is used only to preserve rename history (staging is fine; do not `git commit`). A single optional commit command is provided at the very end.
- **Verification, not unit tests.** This is a routing/layout refactor; correctness is verified with `tsc`, route/redirect HTTP checks, and Playwright screenshots — not Jest. Each task's final step is a concrete command with expected output.
- **All commands run from** `apps/web/` unless stated otherwise. Dev server assumed running via `bun run dev` on `http://localhost:3000` (restart if a task changes `next.config.ts`, which requires a server restart).

## File structure (after Phase 1)

```
apps/web/src/app/
├── layout.tsx              # MODIFIED — minimal root shell (html/body/fonts/globals/scan)
├── providers.tsx           # unchanged (now imported by app/layout.tsx)
├── globals.css             # MODIFIED — add surface-* classes + marketing placeholder styles
├── icon.png, apple-icon.png# unchanged
├── (marketing)/            # NEW
│   ├── layout.tsx          # marketing chrome (nav + footer)
│   └── page.tsx            # placeholder landing → /
├── app/                    # MOVED from root
│   ├── layout.tsx          # NEW — Providers + Masthead + TickerTape + <main.page>
│   ├── page.tsx            # was src/app/page.tsx (markets) → /app
│   ├── agent/[ticker]/…    # moved → /app/agent/*
│   └── launch/…            # moved → /app/launch
└── (docs comes in Phase 3)

apps/web/src/components/
├── masthead.tsx            # MODIFIED — nav/brand links → /app
└── marketing/              # NEW
    ├── marketing-nav.tsx   # stub nav
    └── marketing-footer.tsx# stub footer

apps/web/next.config.ts     # MODIFIED — add redirects()
```

---

## Task 1: Move product routes into `app/` segment and fix relative imports

**Files:**
- Move: `src/app/page.tsx` → `src/app/app/page.tsx`
- Move: `src/app/agent/` → `src/app/app/agent/`
- Move: `src/app/launch/` → `src/app/app/launch/`
- Modify: `src/app/app/launch/launch-client.tsx` (relative imports → `@/` alias)

- [ ] **Step 1: Create the `app/` segment dir and move the three product routes**

Run (from `apps/web/src/app`):
```bash
mkdir app
git mv page.tsx app/page.tsx
git mv agent app/agent
git mv launch app/launch
```
Expected: no output; `ls app/` shows `agent  launch  page.tsx`. Confirm `layout.tsx`, `providers.tsx`, `globals.css`, `icon.png`, `apple-icon.png` remain directly under `src/app/`.

- [ ] **Step 2: Find every relative import in the moved files that reaches outside its own folder**

Run (from `apps/web`):
```bash
grep -rnE 'from "(\.\./)+' src/app/app
```
Expected: matches in `src/app/app/launch/launch-client.tsx` for `../../components/crumb`, `../../components/rail`, `../../lib/og-storage`, `../../components/inference-output`. (Sibling `./` imports like `./launch-client` are fine — they moved together — and are NOT in this list.) If any other file appears, apply the same alias conversion to it in Step 3.

- [ ] **Step 3: Convert those parent-relative imports to the `@/` alias**

In `src/app/app/launch/launch-client.tsx`, replace:
```ts
import { Crumb } from "../../components/crumb";
import { Rail } from "../../components/rail";
```
with:
```ts
import { Crumb } from "@/components/crumb";
import { Rail } from "@/components/rail";
```
and replace:
```ts
import { pinManifestToOgStorage } from "../../lib/og-storage";
import { InferenceOutput } from "../../components/inference-output";
```
with:
```ts
import { pinManifestToOgStorage } from "@/lib/og-storage";
import { InferenceOutput } from "@/components/inference-output";
```
(The `@/` alias maps to `src/`, so these resolve regardless of nesting depth.)

- [ ] **Step 4: Verify no broken parent-relative imports remain in the moved tree**

Run (from `apps/web`):
```bash
grep -rnE 'from "(\.\./)+' src/app/app && echo "FOUND — fix these" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 5: Checkpoint — typecheck**

Run (from `apps/web`):
```bash
bunx tsc --noEmit
```
Expected: exit 0, no output. (Routes won't be reachable until layouts exist in later tasks; typecheck is the gate here.)

---

## Task 2: Create the product layout (`app/layout.tsx`)

**Files:**
- Create: `src/app/app/layout.tsx`

- [ ] **Step 1: Create `src/app/app/layout.tsx` with providers + chrome**

```tsx
import type { ReactNode } from "react";
import { Masthead } from "@/components/masthead";
import { TickerTape } from "@/components/ticker-tape";
import { Providers } from "@/app/providers";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="surface-app">
      <Providers>
        <Masthead />
        <TickerTape />
        <main className="page">{children}</main>
      </Providers>
    </div>
  );
}
```

- [ ] **Step 2: Checkpoint — typecheck**

Run (from `apps/web`):
```bash
bunx tsc --noEmit
```
Expected: exit 0. (`@/app/providers` resolves to `src/app/providers.tsx`, which is unchanged.)

---

## Task 3: Slim the root layout to a minimal shell

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace `src/app/layout.tsx` with the minimal shell (fonts + globals + scan only)**

Replace the entire file with:
```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "slopstock — a stock exchange for AI agents",
  description:
    "Mint productive AI agents as ERC-7857 iNFTs, fractionalize ownership, distribute revenue, and transfer atomically without leaking the weights.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${fraunces.variable} ${hanken.variable}`}>
      <body>
        <div className="scan" aria-hidden />
        {children}
      </body>
    </html>
  );
}
```

The root layout no longer imports `Masthead`, `TickerTape`, or `Providers` — those now live in `app/layout.tsx` (product) only.

- [ ] **Step 2: Checkpoint — typecheck**

Run (from `apps/web`):
```bash
bunx tsc --noEmit
```
Expected: exit 0.

---

## Task 4: Create the `(marketing)` route group with a placeholder landing

**Files:**
- Create: `src/components/marketing/marketing-nav.tsx`
- Create: `src/components/marketing/marketing-footer.tsx`
- Create: `src/app/(marketing)/layout.tsx`
- Create: `src/app/(marketing)/page.tsx`

- [ ] **Step 1: Create the stub marketing nav**

`src/components/marketing/marketing-nav.tsx`:
```tsx
import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="m-nav">
      <Link href="/" className="m-brand">slopstock</Link>
      <nav className="m-nav-links">
        <Link href="/docs">docs</Link>
        <Link href="/app" className="m-cta">Open the app →</Link>
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Create the stub marketing footer**

`src/components/marketing/marketing-footer.tsx`:
```tsx
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
```

- [ ] **Step 3: Create the marketing layout**

`src/app/(marketing)/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="surface-marketing">
      <MarketingNav />
      <main className="m-main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
```

- [ ] **Step 4: Create the placeholder landing page**

`src/app/(marketing)/page.tsx` (real content lands in Phase 2 — this is a deliberate placeholder):
```tsx
import Link from "next/link";

export default function LandingPage() {
  return (
    <section className="m-hero-placeholder">
      <p className="m-eyebrow">▌ slopstock · markets index</p>
      <h1>own the agents that do the work.</h1>
      <p className="m-sub">
        A stock exchange for AI agents. Call one and pay per inference, or buy a
        share and earn pro-rata revenue every time it works — settled on chain.
      </p>
      <div className="m-cta-row">
        <Link href="/app" className="btn primary">Open the app →</Link>
        <Link href="/docs" className="btn">Read the docs</Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Checkpoint — typecheck**

Run (from `apps/web`):
```bash
bunx tsc --noEmit
```
Expected: exit 0. (Marketing placeholder CSS classes are styled in Task 8; unstyled render is acceptable at this step.)

---

## Task 5: Update the masthead nav and brand links to `/app`

**Files:**
- Modify: `src/components/masthead.tsx`

- [ ] **Step 1: Point the brand link at the app home**

In `src/components/masthead.tsx`, replace:
```tsx
<Link href="/" className="brand" aria-label="slopstock home">
```
with:
```tsx
<Link href="/app" className="brand" aria-label="slopstock home">
```

- [ ] **Step 2: Point the nav items at the app routes**

In `src/components/masthead.tsx`, replace the `NAV` array:
```tsx
const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/", label: "markets", match: (p) => p === "/" || p.startsWith("/agent/") },
  { href: "/launch", label: "launch agent", match: (p) => p.startsWith("/launch") },
];
```
with:
```tsx
const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/app", label: "markets", match: (p) => p === "/app" || p.startsWith("/app/agent/") },
  { href: "/app/launch", label: "launch agent", match: (p) => p.startsWith("/app/launch") },
];
```

- [ ] **Step 3: Checkpoint — typecheck**

Run (from `apps/web`):
```bash
bunx tsc --noEmit
```
Expected: exit 0.

---

## Task 6: Update all internal product links to `/app/*`

**Files:**
- Modify (scoped): `src/app/app/**/*.tsx`, `src/components/agent-table.tsx`, `src/components/agent-header.tsx`, `src/components/nav.tsx`

These are the remaining links found in the product code (masthead handled in Task 5). The replacements are scoped to the product tree and product components — **not** `src/components/marketing/` (those were authored with correct `/app` links in Task 4).

- [ ] **Step 1: Apply the link rewrites with scoped seds**

Run (from `apps/web`):
```bash
# /agent/...  →  /app/agent/...   (both string and template-literal hrefs)
grep -rl 'href="/agent/' src/app/app src/components/agent-table.tsx src/components/agent-header.tsx | xargs sed -i 's#href="/agent/#href="/app/agent/#g'
grep -rl 'href={`/agent/' src/app/app src/components/agent-table.tsx src/components/agent-header.tsx | xargs sed -i 's#href={`/agent/#href={`/app/agent/#g'

# /launch  →  /app/launch
grep -rl 'href="/launch"' src/app/app | xargs sed -i 's#href="/launch"#href="/app/launch"#g'

# markets home "/"  →  "/app"   (product files only)
grep -rl 'href="/"' src/app/app src/components/nav.tsx | xargs sed -i 's#href="/"#href="/app"#g'
```
Expected: commands complete without error. (If `grep -rl` finds no files for a pattern, `xargs` receives empty input and is a no-op — safe.)

- [ ] **Step 2: Verify no stale product links remain**

Run (from `apps/web`):
```bash
grep -rnE 'href=(\{`|")/(agent|launch)' src/app/app src/components/agent-table.tsx src/components/agent-header.tsx | grep -v '/app/' && echo "STALE FOUND" || echo "clean"
grep -rn 'href="/"' src/app/app && echo "STALE HOME FOUND" || echo "clean"
```
Expected: `clean` for both. (External `basescan`/`http` links and the marketing components are untouched and correct.)

- [ ] **Step 3: Confirm the marketing components were not touched**

Run (from `apps/web`):
```bash
grep -rn 'href' src/components/marketing/
```
Expected: marketing nav/footer still point to `/`, `/app`, `/docs`, and the github URL — unchanged from Task 4.

- [ ] **Step 4: Checkpoint — typecheck**

Run (from `apps/web`):
```bash
bunx tsc --noEmit
```
Expected: exit 0.

---

## Task 7: Add redirects for the old URLs

**Files:**
- Modify: `src/../next.config.ts` (i.e. `apps/web/next.config.ts`)

- [ ] **Step 1: Add a `redirects()` function to the Next config**

In `apps/web/next.config.ts`, add the `redirects` async function to the `config` object (place it alongside `reactStrictMode`). The resulting `config` object should read:
```ts
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stratum/shared", "@stratum/sdk", "@stratum/contracts-types"],
  outputFileTracingRoot: workspaceRoot,
  async redirects() {
    return [
      { source: "/agent/:path*", destination: "/app/agent/:path*", permanent: false },
      { source: "/launch", destination: "/app/launch", permanent: false },
      // "/" intentionally NOT redirected — it is the landing page now.
    ];
  },
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.fallback = {
      ...cfg.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return cfg;
  },
};
```

- [ ] **Step 2: Restart the dev server (config changes require it)**

Stop the running dev server and start it again:
```bash
bun run dev
```
Expected: server boots, `Ready` logged, listening on `http://localhost:3000`.

- [ ] **Step 3: Checkpoint — verify redirects return 307 with the right Location**

Run:
```bash
curl -sI http://localhost:3000/agent/AUDIT | grep -iE 'HTTP|location'
curl -sI http://localhost:3000/launch | grep -iE 'HTTP|location'
```
Expected: each shows a `307` (or `308`) status and `location:` of `/app/agent/AUDIT` and `/app/launch` respectively.

---

## Task 8: Add `surface-*` scope classes and marketing placeholder styles

**Files:**
- Modify: `src/app/globals.css` (append a new unlayered block)

- [ ] **Step 1: Append the scope classes + marketing placeholder styles to `globals.css`**

Append to the end of `apps/web/src/app/globals.css`:
```css

/* ─── Surface scopes (landing / app / docs) ───────────────────────── */
.surface-app { /* product keeps current density — no overrides needed */ }
.surface-marketing { display: flex; flex-direction: column; min-height: 100vh; }

/* Marketing chrome (Phase 1 stubs; full landing lands in Phase 2) */
.m-nav {
  display: flex; align-items: center; justify-content: space-between;
  height: 64px; padding: 0 32px;
  border-bottom: 1px solid var(--hair);
  background: rgba(248, 244, 237, 0.85);
  backdrop-filter: blur(8px);
  position: sticky; top: 0; z-index: 50;
}
.m-brand { font-weight: 800; font-size: 18px; letter-spacing: -0.01em; color: var(--fg); }
.m-nav-links { display: flex; align-items: center; gap: 22px; font-size: 15px; }
.m-nav-links a { color: var(--fg-2); }
.m-nav-links a:hover { color: var(--accent); }
.m-cta {
  background: var(--accent); color: #fff !important;
  padding: 9px 16px; border-radius: var(--radius-sm);
  font-weight: 600; box-shadow: 0 0 18px rgba(26, 77, 255, 0.3);
}
.m-main { flex: 1; max-width: 1100px; margin: 0 auto; width: 100%; padding: 0 32px; }
.m-hero-placeholder { padding: 96px 0 120px; max-width: 760px; }
.m-eyebrow {
  font-family: var(--font-mono), monospace;
  font-size: 13px; color: var(--mute); letter-spacing: 0.02em; margin: 0 0 24px;
}
.m-hero-placeholder h1 {
  font-family: var(--font-serif);
  font-weight: 300; font-size: clamp(44px, 6vw, 80px);
  line-height: 0.98; letter-spacing: -0.02em; color: #14161b; margin: 0 0 24px;
}
.m-sub { font-size: 19px; line-height: 1.6; color: var(--fg-2); max-width: 56ch; margin: 0 0 32px; }
.m-cta-row { display: flex; gap: 12px; flex-wrap: wrap; }
.m-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 28px 32px; border-top: 1px solid var(--hair);
  color: var(--mute); font-size: 14px;
}
.m-footer-links { display: flex; gap: 18px; }
.m-footer-links a { color: var(--fg-2); }
.m-footer-links a:hover { color: var(--accent); }
@media (max-width: 640px) {
  .m-nav, .m-footer { padding-left: 18px; padding-right: 18px; }
  .m-main { padding: 0 18px; }
}
```

- [ ] **Step 2: Checkpoint — landing renders styled**

With the dev server running, run:
```bash
curl -s http://localhost:3000/ | grep -o 'own the agents that do the work' && echo "landing OK"
```
Expected: prints the headline text and `landing OK`.

---

## Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole app**

Run (from `apps/web`):
```bash
bunx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 2: Verify every product route resolves at its new `/app` path**

Run:
```bash
for u in /app /app/agent/AUDIT /app/agent/AUDIT/subscribe /app/agent/AUDIT/acquire /app/launch; do
  printf '%s -> ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000$u"
done
```
Expected: each prints `200`.

- [ ] **Step 3: Verify the landing and redirects**

Run:
```bash
curl -s -o /dev/null -w '/ -> %{http_code}\n' http://localhost:3000/
curl -sI http://localhost:3000/agent/AUDIT | grep -i location
curl -sI http://localhost:3000/launch | grep -i location
```
Expected: `/ -> 200`; redirect `location` headers point to `/app/agent/AUDIT` and `/app/launch`.

- [ ] **Step 4: Visual parity — screenshot the product at its new paths**

Using the Playwright MCP browser (resize to 1440×900 first), navigate to and screenshot each of `/app`, `/app/agent/AUDIT`, `/app/agent/AUDIT/subscribe`, `/app/agent/AUDIT/acquire`, `/app/launch`, and `/`. Confirm:
- The five product screens look identical to the pre-split daylight versions (masthead + ticker present, wallet connect works).
- `/` shows the marketing placeholder (Fraunces headline, marketing nav + footer, **no** masthead/ticker).

- [ ] **Step 5: Confirm the landing ships no wallet bundle**

In the Playwright browser, open `/`, then check the network requests (or run in the page console):
```js
performance.getEntriesByType('resource').filter(r => /rainbow|wagmi|walletconnect|metamask/i.test(r.name)).map(r => r.name)
```
Expected: empty array `[]` on `/` (wallet libs load only inside `/app/*`).

- [ ] **Step 6: Final checkpoint**

All of: `tsc` clean, five `/app/*` routes 200, `/` 200 with placeholder, old paths redirect, product visually unchanged, no wallet bundle on landing. Phase 1 done.

---

## Optional: commit when out of demo-prep

Commits were intentionally skipped. To capture Phase 1 later in one commit:
```bash
git add -A
git commit -m "refactor(web): split landing / app / docs surfaces — move product under /app, slim root layout, add redirects

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage (§4 of spec):** route tree (Tasks 1–4), root-layout slimming (Task 3), providers/chrome relocation (Task 2), masthead + internal link updates (Tasks 5–6), redirects (Task 7), surface scope classes (Task 8), Phase-1 acceptance criteria (Task 9, incl. no-wallet-on-landing check). Landing/docs *content* are out of scope here (Phases 2–3) by design.
- **Type consistency:** layout component names (`RootLayout`, `AppLayout`, `MarketingLayout`, `LandingPage`), component exports (`MarketingNav`, `MarketingFooter`, `Masthead`, `TickerTape`, `Providers`), and the `@/app/providers` import path are consistent across tasks.
- **Placeholder scan:** the landing `page.tsx` is a *deliberate* placeholder (called out), not an unspecified gap; all code/command steps are complete and concrete.
