// apps/web/src/lib/docs/load.test.ts
import { test, expect } from "bun:test";
import { loadDoc, resolveDocFile } from "./load";
import { DEFAULT_DOC } from "./docs-nav";

test("empty slug resolves to the default doc file", () => {
  expect(resolveDocFile([])).toBe(DEFAULT_DOC.file);
});

test("known slug resolves to its file", () => {
  expect(resolveDocFile(["harness", "routing"])).toBe("harness/routing.mdx");
});

test("unknown slug resolves to undefined", () => {
  expect(resolveDocFile(["nope", "nope"])).toBeUndefined();
});

test("loadDoc returns null when the resolved MDX file does not exist", async () => {
  // Valid nav slug, but its MDX file is not authored yet on disk.
  expect(resolveDocFile(["harness", "routing"])).toBe("harness/routing.mdx");
  expect(await loadDoc(["harness", "routing"])).toBeNull();
});
