// apps/web/src/lib/docs/toc.test.ts
import { test, expect } from "bun:test";
import { extractToc, slugifyHeading } from "./toc";

test("slugifyHeading matches rehype-slug style", () => {
  expect(slugifyHeading("The money-loop")).toBe("the-money-loop");
  expect(slugifyHeading("ENS + ERC-8004 identity")).toBe("ens--erc-8004-identity");
});

test("slugifyHeading keeps Unicode letters (rehype-slug does)", () => {
  expect(slugifyHeading("über café")).toBe("über-café");
  expect(slugifyHeading("日本語 heading")).toBe("日本語-heading");
});

test("extractToc dedups duplicate headings like github-slugger", () => {
  const src = ["## Setup", "## Setup", "## Setup"].join("\n");
  expect(extractToc(src)).toEqual([
    { text: "Setup", id: "setup", depth: 2 },
    { text: "Setup", id: "setup-1", depth: 2 },
    { text: "Setup", id: "setup-2", depth: 2 },
  ]);
});

test("extractToc preserves non-ASCII heading text and id", () => {
  expect(extractToc("## über café")).toEqual([
    { text: "über café", id: "über-café", depth: 2 },
  ]);
});

test("extractToc skips tilde fences and strips closed-ATX hashes", () => {
  const src = [
    "## Heading ##",
    "~~~ts",
    "## not a heading (in tilde fence)",
    "~~~",
    "## After fence",
  ].join("\n");
  expect(extractToc(src)).toEqual([
    { text: "Heading", id: "heading", depth: 2 },
    { text: "After fence", id: "after-fence", depth: 2 },
  ]);
});

test("extractToc pulls h2 and h3 with ids and depth", () => {
  const src = [
    "# Title (ignored)",
    "",
    "## First section",
    "text",
    "### Sub point",
    "## Second section",
    "```ts",
    "## not a heading (in code fence)",
    "```",
  ].join("\n");
  expect(extractToc(src)).toEqual([
    { text: "First section", id: "first-section", depth: 2 },
    { text: "Sub point", id: "sub-point", depth: 3 },
    { text: "Second section", id: "second-section", depth: 2 },
  ]);
});
