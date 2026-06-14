// apps/web/src/lib/docs/toc.test.ts
import { test, expect } from "bun:test";
import { extractToc, slugifyHeading } from "./toc";

test("slugifyHeading matches rehype-slug style", () => {
  expect(slugifyHeading("The money-loop")).toBe("the-money-loop");
  expect(slugifyHeading("ENS + ERC-8004 identity")).toBe("ens--erc-8004-identity");
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
