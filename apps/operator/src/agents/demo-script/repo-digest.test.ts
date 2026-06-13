/**
 * Step 1 tests — repo-digest module
 *
 * Integration tests against the REAL GitHub API (public repo, unauthenticated).
 * Tests marked "unit" run offline; "integration" require network.
 *
 * NOTE: To avoid GitHub rate-limit (60 req/hr unauthenticated), all integration
 * tests share a single digest fetched once via a module-level promise.
 * Set GITHUB_TOKEN env var for 5000 req/hr limit.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  digestRepo,
  parseGithubUrl,
  isInteresting,
  estimateTokens,
  RepoNotFoundError,
  RepoPrivateError,
  type RepoDigest,
} from "./repo-digest.ts";

// ─── Unit tests (no network) ──────────────────────────────────────────────

describe("parseGithubUrl", () => {
  test("parses basic github URL", () => {
    const r = parseGithubUrl("https://github.com/forever8896/slopstock");
    expect(r.owner).toBe("forever8896");
    expect(r.repo).toBe("slopstock");
    expect(r.ref).toBeUndefined();
  });

  test("parses tree URL with branch", () => {
    const r = parseGithubUrl("https://github.com/forever8896/slopstock/tree/main");
    expect(r.owner).toBe("forever8896");
    expect(r.repo).toBe("slopstock");
    expect(r.ref).toBe("main");
  });

  test("throws RepoNotFoundError on non-github URL", () => {
    expect(() => parseGithubUrl("https://gitlab.com/foo/bar")).toThrow(RepoNotFoundError);
  });
});

describe("isInteresting", () => {
  test("includes README.md", () => expect(isInteresting("README.md")).toBe(true));
  test("includes README.mdx", () => expect(isInteresting("README.mdx")).toBe(true));
  test("includes readme.txt", () => expect(isInteresting("readme.txt")).toBe(true));
  test("includes package.json", () => expect(isInteresting("package.json")).toBe(true));
  test("includes solidity files", () => expect(isInteresting("contracts/Vault.sol")).toBe(true));
  test("includes index.ts", () => expect(isInteresting("src/index.ts")).toBe(true));
  test("includes main.ts", () => expect(isInteresting("app/main.ts")).toBe(true));
  test("excludes PNG images", () => expect(isInteresting("logo.png")).toBe(false));
  test("excludes lockfiles", () => expect(isInteresting("bun.lockb")).toBe(false));
  test("excludes node_modules", () => expect(isInteresting("node_modules/foo/index.ts")).toBe(false));
  test("excludes dist artifacts", () => expect(isInteresting("dist/index.js")).toBe(false));
  test("excludes .map files", () => expect(isInteresting("bundle.js.map")).toBe(false));
  test("excludes wasm binaries", () => expect(isInteresting("module.wasm")).toBe(false));
});

// ─── Integration tests (require network + GitHub API) ─────────────────────
// All share a single digest call to minimise API rate-limit exposure.

describe("digestRepo — integration", () => {
  let digest: RepoDigest | null = null;
  let fetchError: unknown = null;

  beforeAll(async () => {
    try {
      digest = await digestRepo("https://github.com/forever8896/slopstock");
    } catch (err) {
      fetchError = err;
    }
  }, 30_000);

  test("slopstock repo: fetch succeeds (or rate-limited gracefully)", () => {
    // If rate-limited, fetchError will be a RepoNotFoundError or similar
    // from a 403. We soft-skip in that case (CI without GITHUB_TOKEN).
    if (fetchError) {
      const msg = String(fetchError instanceof Error ? fetchError.message : fetchError);
      if (msg.includes("403") || msg.includes("rate limit") || msg.includes("not found")) {
        console.warn("[repo-digest.test] GitHub rate limit or access error — skipping (set GITHUB_TOKEN)");
        return; // graceful skip
      }
      throw fetchError; // unexpected error — re-throw
    }
    expect(digest).not.toBeNull();
    expect(digest!.owner).toBe("forever8896");
    expect(digest!.repo).toBe("slopstock");
    expect(digest!.sha).toBeTruthy();
  });

  test("slopstock repo: returns tree with >5 entries", () => {
    if (!digest) return; // skip if fetch failed
    expect(digest.tree.length).toBeGreaterThan(5);
  });

  test("slopstock repo: includes interesting files in excerpts", () => {
    if (!digest) return;
    expect(digest.excerpts.length).toBeGreaterThan(0);
    const hasReadme = digest.excerpts.some((e) =>
      /readme/i.test(e.path) || e.path === "package.json",
    );
    expect(hasReadme).toBe(true);
  });

  test("slopstock repo: excludes binary blobs from excerpts", () => {
    if (!digest) return;
    for (const excerpt of digest.excerpts) {
      const ext = excerpt.path.split(".").pop()?.toLowerCase() ?? "";
      expect(["png", "jpg", "jpeg", "gif", "wasm", "lock"]).not.toContain(ext);
    }
  });

  test("slopstock repo: total token estimate < 4096", () => {
    if (!digest) return;
    const tokens = estimateTokens(digest);
    expect(tokens).toBeLessThan(4096);
  });

  test(
    "invalid repo URL throws RepoNotFoundError (or RepoPrivateError if rate-limited)",
    async () => {
      // Under rate-limit, GitHub returns 403, which we map to RepoPrivateError.
      // When not rate-limited, a non-existent repo returns 404 → RepoNotFoundError.
      // Either is acceptable — the key invariant is that it throws before any LLM call.
      let threw = false;
      let isExpectedError = false;
      try {
        await digestRepo("https://github.com/forever8896/this-repo-does-not-exist-xyzzy-2026");
      } catch (e) {
        threw = true;
        isExpectedError = e instanceof RepoNotFoundError || e instanceof RepoPrivateError;
      }
      expect(threw).toBe(true);
      expect(isExpectedError).toBe(true);
    },
    15_000,
  );

  // Note: testing private repo (403 → RepoPrivateError) would require a
  // real private repo. We test the error class construction instead.
  test("RepoPrivateError has friendly message", () => {
    const err = new RepoPrivateError("https://github.com/private/repo");
    expect(err.message).toContain("private");
    expect(err.name).toBe("RepoPrivateError");
  });
});
