# Docs surface — protocol reference (Phase 3)

**Status:** Design approved 2026-06-14 · awaiting spec review before implementation planning
**Scope:** Build the `/docs` surface promised by the platform-split spec ([`docs/13-platform-split-landing-docs.md`](../../13-platform-split-landing-docs.md) §6), but raised to a *protocol reference* — a designed explanation of Slopstock's architectural flows and the Hermes harness, not a plain prose dump.
**Owner:** Kilian Valdman
**Builds on:** doc 13 (platform split) Phases 1 (structural split) + 2 (landing) are done; this is Phase 3.

---

## 1. Why

The landing (`/`) and app (`/app/*`) surfaces exist; `/docs` is still a stub link in the marketing nav and a 404. Slopstock has a lot of genuinely unusual architecture — sealed TEE inference, ENS + ERC-8004 identity with ENSIP-25 verification, a Walrus + Seal stateless operator addressed by an ENS pointer, an x402 payment triangle, and a stateful **Hermes-pattern harness** that authors its own skills and survives amnesia. A generic wiki of migrated PRDs would undersell all of it.

The goal: docs that **feel like a protocol** — the architectural flows are shown as designed figures, the harness gets its own deep section, and every claim reflects the **current** stack (Base mainnet · ENS/ERC-8004 · Walrus · Seal · Dynamic · x402 v2 · Hermes on 0g-compute), not the original 0G/Stratum PRDs.

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Approach | **Hybrid** — MDX content pipeline + bespoke React figure library | Prose scales via MDX; the flows + harness get hand-designed components. Matches doc 13's "custom MDX in our design system" while delivering the protocol feel. |
| MDX mechanism | **`next-mdx-remote/rsc`** + `rehype-pretty-code` (Shiki), `remark-gfm`, `gray-matter`, `rehype-slug` | Lightest path to "MDX with our own components inside a `[[...slug]]` catch-all," fully RSC (no wallet/JS bundle on docs). |
| Content truth | **Current stack** | Derive from nyc-2026 MASTERPLAN + code (`runtime/index.ts`, `hermes.ts`, plan 12, `02-ens-erc8004`, `03-walrus`, `08-hermes-fidelity`), not the stale 0G PRDs (`docs/00–12`). |
| Information architecture | **Granular, 5 groups** (see §5) | "Feel like a protocol through a proper structure explanation" = explicit structure; the harness is its own group. |
| Navigation | **Sidebar (left) + TOC rail (right)**, config-driven | Per doc 13 §6.1. |
| Search | **Cut for v1** (Pagefind later) | Per doc 13 §6.3. |

Rejected: `@next/mdx` file-as-route (fights the catch-all + central nav config + frontmatter); Velite/content-collections (extra build tooling, overkill for now); fully-bespoke hand-authored React pages (highest polish but slow + hard to extend); plain MDX with static ASCII flows (won't "feel like a protocol").

## 3. Architecture

### 3.1 Route & file tree

```
src/app/docs/
├── layout.tsx            # surface-docs shell: DocsSidebar + content + TocRail. No wallet providers.
└── [[...slug]]/
    └── page.tsx          # resolve slug → MDX file → compile + render; generateStaticParams from nav
src/content/docs/         # the content (MDX, frontmatter: title, description, group, order)
│   ├── introduction/
│   ├── protocol/
│   ├── harness/
│   ├── flows/
│   └── build/
src/lib/docs/
├── docs-nav.ts           # ordered groups → pages; single source of truth for the sidebar + params
├── load.ts               # slug → file path, gray-matter frontmatter, MDX source read
└── toc.ts                # extract h2/h3 headings → TOC entries
src/components/docs/       # the bespoke figure + chrome library (§3.3)
```

### 3.2 Rendering data flow

Build/request time (all RSC, no client wallet bundle):

1. `[[...slug]]/page.tsx` takes the slug (empty → `introduction/overview`).
2. `load.ts` resolves slug → MDX file, parses frontmatter (`gray-matter`), returns source + meta.
3. `next-mdx-remote/rsc` `compileMDX` renders the body with: the custom **component map** (§3.3), `remark-gfm`, `rehype-slug`, `rehype-pretty-code` (Shiki, daylight-themed).
4. `layout.tsx` wraps it with `DocsSidebar` (from `docs-nav.ts`) + `TocRail` (from `toc.ts`) + `Breadcrumb`/`PrevNext`.
5. Unknown slug → `notFound()` (404).

`generateStaticParams` enumerates `docs-nav.ts` so every page is statically generated.

### 3.3 Bespoke component library (`src/components/docs/`)

Presentational, mostly Server Components, styled in `globals.css` under `surface-docs`. Passed into MDX via the component map so `.mdx` files use them as tags.

**Figures (the "protocol feel"):**
- `FlowDiagram` — declarative lane/step diagram (actors as columns, ordered steps + arrows) as styled HTML/SVG; responsive (collapses vertical on mobile). The designed successor to the ASCII flows in `01-architecture.md`. Props: `lanes`, `steps`. Used by every Flow page.
- `HarnessMatrix` — the runtime × backend routing grid (`hermes`/`openai-compat` runtimes × `0g-compute`/`openai-compat` backends) as a designed 2×2 matrix with selection-precedence notes. Harness centerpiece.
- `SystemMap` / `StackLayer` — top-level architecture map (Base · ENS/ERC-8004 · Walrus · Seal · Dynamic · x402 · operator/Hermes) as labelled layers.
- `ContractCard` — per-contract card: name, chain, responsibility, optional address/link.

**Prose primitives + chrome:**
- `Callout` (variants: note / warn / onchain), `Steps`/`Step`, `Defn` (glossary term anchor), `AddressPill` (mono + Basescan/ENS link), `StatInline`.
- `DocsSidebar`, `TocRail`, `Breadcrumb`, `PrevNext`.

### 3.4 Styling

New `surface-docs` scope class in `globals.css` (single global stylesheet, per doc 13 §7), reusing daylight tokens — Fraunces headings, Hanken body, JetBrains Mono for code/addresses, `--accent` #1a4dff. Docs-specific styles (sidebar, TOC rail, prose rhythm, the figure components) added under `surface-docs`. No token duplication; visually one family with landing + app. Shiki theme tuned to daylight.

## 4. Dependencies (new, docs-only, light)

`next-mdx-remote`, `shiki`, `rehype-pretty-code`, `remark-gfm`, `rehype-slug`, `gray-matter`. None ship to the app or landing surfaces.

## 5. Information architecture & content

Groups → pages. Content is **rewritten public-facing** from current-stack sources; honest framing preserved ("Hermes-**pattern**", testnet vs mainnet status).

| Group | Page | Primary source(s) |
|---|---|---|
| **Introduction** | Overview / thesis | README, marketing page, MASTERPLAN north-star |
| | Concepts & glossary | derived across docs (iNFT, shares, vault, IPO, TEE, attestation, x402, ENSIP-25, Seal, Walrus, snapshot pointer, Hermes, skill, bundle hash) |
| **Protocol** | Architecture (SystemMap) | `01-architecture` (modernized), MASTERPLAN |
| | Smart contracts (ContractCards) | `02-smart-contracts`, `contracts/src/*` |
| | ENS + ERC-8004 identity | `02-ens-erc8004` (live #55228/#55229, ENSIP-25/26) |
| | Sealed inference (TEE) | `03-sealed-inference`, `08-hermes-fidelity` |
| | Revenue & payouts | `04-revenue-and-payments`, `06-revenue-and-economics` |
| | x402 payment triangle | `05-x402-v2` (inbound/outbound/internal) |
| | Walrus stateless storage | `03-walrus` + plan 12 (Seal cipher + ENS snapshot pointer) |
| **The Harness** | Hermes overview | `hermes.ts` header, `08-hermes-fidelity` |
| | Skills (self-authored) | `08-hermes-fidelity` (skill_manage, slug upsert), `skills.ts` |
| | Three-layer memory | `08-hermes-fidelity` (MEMORY.md/USER.md + memory.db FTS5) |
| | Snapshot / restore (amnesia) | plan 12, `snapshot.ts`, `amnesia-demo.ts` |
| | Runtime × backend routing (HarnessMatrix) | `runtime/index.ts` |
| **Flows** | Launch | `01-architecture` §3.1, launch rework plan |
| | The money-loop | `01-architecture` §3.3, `smoke-e2e-full-loop.ts` |
| | a2a discovery | `02-ens-erc8004` (ENS discover → ENSIP-25 verify → x402 pay) |
| | Acquisition | `01-architecture` §3.5 (whole-iNFT re-encrypt transfer) |
| **Build** | Launch an agent (guide voice) | `12-real-agent-launch`, launch rework |

Internal-only docs (execution plan, risks, demo scripts, nyc-2026 planning) stay internal and are **not** published.

## 6. Acceptance criteria

- `/docs` lands on Overview; every page in `docs-nav.ts` renders with sidebar + TOC.
- Sidebar reflects the §5 IA, grouped + ordered; active page highlighted.
- TOC rail auto-generated from h2/h3; code blocks highlight (Shiki, daylight).
- At least one `FlowDiagram` (a Flow page) and the `HarnessMatrix` render correctly, desktop + mobile.
- `SystemMap` renders on Architecture; `ContractCard`s on Smart contracts.
- Unknown slug → 404; internal doc links resolve.
- No wallet JS bundle on `/docs` (network tab); fast first paint.
- Content reads as public protocol reference describing the **current** stack — not internal planning notes, not the old 0G stack.
- `tsc --noEmit` clean; nav↔file consistency check passes.

## 7. Out of scope

- Full-text search (Pagefind later), dark mode, versioning, edit-on-GitHub.
- Any backend (`gateway`/`indexer`/`operator`/`subscriber`) or contract changes.
- Subdomain split / multi-zone (future, via Vercel rewrites — doc 13 §9).
- Changes to landing or app surfaces beyond the shared `globals.css` additions.

## 8. Risks

- **Content is real writing work**, not a mechanical move (doc 13 §8). Drafts derive from the §5 sources; voice needs a human review pass.
- **Stale-source trap.** The `docs/00–12` PRDs describe the *old* 0G/Stratum stack; content MUST be reconciled to the current stack via MASTERPLAN + code before publishing.
- **New deps.** Six light docs-only packages; verify they don't leak into the app/landing bundles.
- **`apps/web` collision.** MASTERPLAN notes Claude stays out of `apps/web/*` unless asked; user has explicitly asked. Working tree verified clean of `apps/web` changes at design time.

## 9. Sequencing (for the implementation plan)

1. **Pipeline** — deps, `docs-nav.ts`, `load.ts`, `toc.ts`, `[[...slug]]` route + docs layout shell, `surface-docs` base styles. Verify a single placeholder MDX renders with sidebar + TOC.
2. **Component library** — `FlowDiagram`, `HarnessMatrix`, `SystemMap`/`StackLayer`, `ContractCard`, callouts/steps/chrome + their `surface-docs` styles. Verify each in isolation.
3. **Content** — author the §5 pages from current-stack sources, wiring the figures. Verify acceptance criteria.

Each step is independently shippable + verifiable.
