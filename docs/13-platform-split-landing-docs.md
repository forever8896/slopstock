# 13 · Platform Split — Landing / App / Docs

**Status:** Design approved 2026-06-13 · awaiting spec review before implementation planning
**Scope:** Restructure `apps/web` into three distinct surfaces — a marketing **landing** (`/`), the **product app** (`/app/*`), and a **docs** site (`/docs/*`) — sharing one codebase, one deployment, and the daylight design system.
**Owner:** Kilian Valdman

---

## 1. Why

Today `apps/web` serves the product (the markets exchange) directly at `/`. There is no marketing surface and no public documentation. Every serious protocol separates these concerns:

- **Landing** sells the thesis and converts visitors → drives to the app or docs. It wants big, confident copy and visual polish, no product chrome, and a fast first paint.
- **App** is the working exchange. It wants dense data UI, wallet connectivity, and the terminal-flavored daylight system already built.
- **Docs** is the protocol reference. It wants legible long-form prose, navigation, and brand-consistent styling.

Mixing all three into one root layout forces compromises: the landing inherits the product's wallet bundle and masthead, there's nowhere for marketing copy to live, and documentation has no home. Splitting them unlocks independent, high-impact polish on each.

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Topology | **One Next app, route groups** | Shared design tokens, one deploy, fastest. Promotable to subdomains later via Vercel rewrites with no code rewrite. |
| Product path | **`/app`** | Conventional "enter the product" boundary (app.\*, /app). |
| Docs stack | **Custom MDX in our design system** | Brand-perfect; reuses existing `./docs` content; full layout control. |
| Sequencing | **Phased: split → landing → docs** | Each phase is independently shippable and verifiable. |

Rejected: subdomains (DNS + 3 deploys, too heavy now), Next multi-zone (more config than needed), Fumadocs/Nextra (opinionated themes fight the daylight brand).

## 3. Target information architecture

| Surface | URL(s) | Layout / chrome | Wallet | Purpose |
|---|---|---|---|---|
| Landing | `/` | Marketing nav + footer | No | Thesis, conversion |
| App | `/app`, `/app/agent/[ticker]`, `/app/agent/[ticker]/subscribe`, `/app/agent/[ticker]/acquire`, `/app/launch` | Masthead + ticker tape | Yes | The exchange |
| Docs | `/docs`, `/docs/[...slug]` | Sidebar + right-rail TOC | No | Protocol reference |

## 4. Routing & layout refactor (Phase 1)

### 4.1 Target route tree

```
src/app/
├── layout.tsx              # ROOT: <html><body>, font variables, global tokens. NO chrome, NO providers.
├── (marketing)/
│   ├── layout.tsx          # marketing nav + footer
│   └── page.tsx            # LANDING                         → /
├── app/
│   ├── layout.tsx          # Providers (wagmi/RainbowKit) + Masthead + TickerTape
│   ├── page.tsx            # markets index (today's /)       → /app
│   ├── agent/
│   │   └── [ticker]/
│   │       ├── page.tsx                                      → /app/agent/AUDIT
│   │       ├── subscribe/page.tsx                            → /app/agent/AUDIT/subscribe
│   │       └── acquire/page.tsx                              → /app/agent/AUDIT/acquire
│   └── launch/
│       └── page.tsx                                          → /app/launch
└── docs/
    ├── layout.tsx          # docs shell: sidebar + TOC
    └── [[...slug]]/
        └── page.tsx        # MDX renderer                    → /docs, /docs/architecture, …
```

### 4.2 Critical refactors

- **Root layout becomes minimal.** It keeps only `<html>`/`<body>`, the three font CSS variables (`--font-mono`, `--font-fraunces`, `--font-sans`), `globals.css`, and the global scanline overlay. It must **not** render `Masthead`, `TickerTape`, or `Providers`.
- **Providers move into `app/layout.tsx`.** wagmi/RainbowKit/React-Query wrap only the product. Result: the landing and docs render as light, mostly-static pages with no wallet bundle — meaningful perf and bundle-size win.
- **Product chrome moves into `app/layout.tsx`.** `Masthead` + `TickerTape` wrap the product only.
- **`Masthead` nav links update** to `/app`, `/app/launch` (currently `/`, `/launch`). Its `NAV.match` predicates update accordingly.
- **Internal product links update.** Every `href="/agent/…"`, `href="/launch"`, `href="/"` (as "markets home") inside product components/pages becomes `/app/…`. Inventory required (grep) before edit.

### 4.3 Redirects (demo-critical)

Add to `next.config.ts` so existing links, the demo flow, and `docs/screenshots` references keep working:

```ts
async redirects() {
  return [
    { source: "/agent/:path*", destination: "/app/agent/:path*", permanent: false },
    { source: "/launch", destination: "/app/launch", permanent: false },
    // NOTE: do NOT redirect "/" — it is now the landing page, intentionally.
  ];
}
```

`permanent: false` (307) during the hackathon so we can revise without poisoning caches.

### 4.4 Per-surface scope class

Each group layout adds a wrapper class — `surface-marketing`, `surface-app`, `surface-docs` — on its top-level element. This lets landing and docs tune base spacing/density/type-scale without leaking into the dense product UI. Product keeps current values under `surface-app`.

### 4.5 Phase 1 acceptance

- `/app`, `/app/agent/AUDIT`, `/app/agent/AUDIT/subscribe`, `/app/agent/AUDIT/acquire`, `/app/launch` all render exactly as before the move.
- `/agent/AUDIT` and `/launch` 307-redirect to their `/app` equivalents.
- `/` renders a placeholder landing (real content is Phase 2); no masthead/ticker; no wallet bundle in its network tab.
- Wallet connect still works inside `/app/*`.
- `tsc --noEmit` clean; all five product screens visually unchanged.

## 5. Landing page (Phase 2)

A marketing page in the daylight system (Fraunces display, Hanken body, JetBrains Mono for data accents, electric-blue actions), no product chrome.

### 5.1 Sections

1. **Hero** — Fraunces headline on the thesis (working line: *"own the agents that do the work."*), one-sentence subhead, dual CTA (`Open the app →` primary, `Read the docs` secondary), one honest live stat strip (agents serving · total paid on-chain · pulled from the same data source as the app).
2. **The thesis** — "agents as productive property" in one tight, confident block. What it means, why it's new.
3. **How it works** — three beats: **call · own · earn**. The polished, legible successor to the rejected ASCII flow — designed marketing cards/figures, not terminal art.
4. **Proof, not theater** — real on-chain numbers + the actual `AUDIT ▸ ORCL` payment tx with Basescan link. Concrete; nothing fabricated.
5. **For builders** — "launch your own agent" CTA into `/app/launch`.
6. **Footer** — docs, GitHub, socials, protocol links.

### 5.2 Copy strategy

Impact-first, concrete, anti-hype. Every claim is backed by something real (a number, a tx, a mechanism) or it gets cut. This mirrors the confidence-theater removal already done in the app.

### 5.3 Components

New, marketing-only, under `src/components/marketing/`: `MarketingNav`, `Hero`, `ThesisBlock`, `HowItWorks`, `ProofStrip`, `BuilderCta`, `MarketingFooter`. Live stats fetched server-side via the existing agents data layer (`@/lib/agents`) so the landing stays a fast Server Component.

### 5.4 Phase 2 acceptance

- Landing renders all sections responsively (desktop + mobile).
- CTAs route to `/app` and `/docs`.
- Live stat strip shows real data and degrades gracefully if the data source is unavailable.
- Lighthouse: no wallet JS on the landing; fast first paint.

## 6. Docs (Phase 3)

Custom MDX docs in the daylight theme.

### 6.1 Mechanics

- Content as MDX files under `src/content/docs/*.mdx`, each with frontmatter (`title`, `description`, `order`/`group`).
- `/docs/[[...slug]]` catch-all resolves slug → MDX file, renders via MDX (`@next/mdx` or `next-mdx-remote`; decide in the implementation plan).
- **Left sidebar** built from a `docs-nav.ts` config (ordered groups → pages).
- **Right-rail TOC** auto-generated from `h2`/`h3` headings.
- **Code highlighting** via Shiki, themed to daylight.
- Prose styled with Fraunces headings, Hanken body, mono for inline code/addresses.

### 6.2 Content seed

The existing `./docs/00–12` PRDs are raw material, edited from internal-planning voice into public-facing reference. Proposed public structure:

| Docs page | Source | Notes |
|---|---|---|
| Overview | 00-master-prd | Rewritten as a product/protocol intro |
| Architecture | 01-architecture | |
| Smart Contracts | 02-smart-contracts | |
| Sealed Inference (TEE) | 03-sealed-inference | |
| Revenue & Payments | 04-revenue-and-payments | |
| ENS Identity | 05-ens-identity | |
| Launch an Agent | 12-real-agent-launch | How-to / guide voice |

Internal-only docs (execution plan, risks, demo, nyc-2026) stay internal and are **not** published.

### 6.3 Cut for v1

Full-text search (add Pagefind later). v1 ships with sidebar + TOC navigation only.

### 6.4 Phase 3 acceptance

- `/docs` lands on Overview; every seeded page renders with sidebar + TOC.
- Code blocks highlight; internal doc links resolve.
- Content reads as public reference, not internal planning notes.

## 7. Shared design system

`globals.css` remains the single global stylesheet, shared across all three surfaces. New marketing- and docs-specific component styles are added there (or co-located) under the `surface-*` scope classes. No design-token duplication; the three surfaces are visually one family.

## 8. Risks & cuts

- **Redirects are demo-critical.** Verify `/agent/*` and `/launch` redirects before anything else ships in Phase 1. `docs/screenshots` and any external demo links assume the old paths.
- **Provider scope change.** Moving `Providers` into `app/layout.tsx` must not break wallet hydration in the product; verify connect + a signed action still work.
- **Docs content is real writing work.** Editing 7 internal PRDs into public docs is non-trivial prose work, not a mechanical move — flagged explicitly, not hidden in "migrate content."
- **Landing live stats** must degrade gracefully (no crash if the data layer is down during a demo).
- **Search deferred** in docs v1.

## 9. Out of scope

- Subdomain split / multi-zone (future, via Vercel rewrites).
- Docs full-text search.
- Auth / gated content.
- Any backend (`gateway`/`indexer`/`operator`/`subscriber`) changes.

## 10. Sequencing summary

- **Phase 1 — Structural split.** Route groups, layout refactor, provider/chrome relocation, redirects, link updates. Product unchanged visually. *Ship + verify.*
- **Phase 2 — Landing.** Marketing nav/footer, hero, sections, copy, responsive polish. *Ship + verify.*
- **Phase 3 — Docs.** MDX pipeline, docs shell, content migration, highlighting. *Ship + verify.*

Each phase gets its own implementation plan and verification pass.
