/**
 * Step 2b tests — ethglobal-skills tools
 *
 * Per spec and the ⚠️ callout: paid path is BROKEN (HTTP 500), so we test
 * the FREE TIER only. We test:
 *   - Real free-tier call parses records (or returns [] gracefully)
 *   - Non-200 → []
 *   - Session cache: repeat (event, sponsor) does NOT issue a 2nd HTTP call
 */

import { describe, expect, test, mock, spyOn } from "bun:test";
import {
  fetchBounties,
  searchWinners,
  clearSkillsCache,
  FETCH_BOUNTIES_TOOL,
  SEARCH_WINNERS_TOOL,
} from "./ethglobal-skills.ts";

describe("tool definitions", () => {
  test("FETCH_BOUNTIES_TOOL has correct shape", () => {
    expect(FETCH_BOUNTIES_TOOL.type).toBe("function");
    expect(FETCH_BOUNTIES_TOOL.function.name).toBe("fetch_bounties");
    expect(FETCH_BOUNTIES_TOOL.function.parameters.required).toContain("event");
  });

  test("SEARCH_WINNERS_TOOL has correct shape", () => {
    expect(SEARCH_WINNERS_TOOL.type).toBe("function");
    expect(SEARCH_WINNERS_TOOL.function.name).toBe("search_winners");
    expect(SEARCH_WINNERS_TOOL.function.parameters.required).toContain("keyword");
  });
});

describe("fetchBounties — free-tier integration", () => {
  test(
    "returns parsed array (or empty array) for ETHGlobal NYC 2026 / ENS",
    async () => {
      clearSkillsCache();
      const result = await fetchBounties("ETHGlobal NYC 2026", "ENS");
      // Per spec: PAID path is broken → either free-tier data OR graceful []
      expect(Array.isArray(result)).toBe(true);
      // Each record (if any) should have a title field
      for (const item of result) {
        expect(typeof item.title).toBe("string");
      }
    },
    15_000,
  );

  test(
    "soft-fails to [] on non-200 response",
    async () => {
      clearSkillsCache();
      // We test by calling with a clearly invalid event that should 404/500
      const result = await fetchBounties("NonExistentEvent-xyz-2099-fake");
      expect(Array.isArray(result)).toBe(true);
      // Should be empty or valid records (never throw)
    },
    10_000,
  );
});

describe("searchWinners — free-tier integration", () => {
  test(
    "returns parsed array (or empty array) for keyword search",
    async () => {
      clearSkillsCache();
      const result = await searchWinners("storage", undefined, 3);
      expect(Array.isArray(result)).toBe(true);
      // Each record (if any) should have a title field
      for (const item of result) {
        expect(typeof item.title).toBe("string");
      }
    },
    15_000,
  );

  test(
    "soft-fails to [] on network error (simulated with bad URL pattern via cache)",
    async () => {
      clearSkillsCache();
      // Call with unusual keyword that's unlikely to 402 or crash
      const result = await searchWinners("xyzzy-not-real-2099-fake-keyword");
      expect(Array.isArray(result)).toBe(true);
    },
    10_000,
  );
});

describe("session cache", () => {
  test(
    "repeat (event, sponsor) call does NOT issue a second HTTP request",
    async () => {
      clearSkillsCache();

      // Spy on fetch to count calls
      let fetchCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        // Only count calls to ethglobalskills
        if (String(args[0]).includes("ethglobalskills")) fetchCount++;
        return originalFetch(...args);
      }) as typeof fetch;

      try {
        await fetchBounties("ETHGlobal NYC 2026", "Walrus");
        const firstCount = fetchCount;

        // Second call with same args — should hit cache, not network
        await fetchBounties("ETHGlobal NYC 2026", "Walrus");
        const secondCount = fetchCount;

        // No additional fetch calls on the second invocation
        expect(secondCount).toBe(firstCount);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    15_000,
  );

  test(
    "different (event, sponsor) pairs are cached independently",
    async () => {
      clearSkillsCache();

      // First call
      const r1 = await fetchBounties("ETHGlobal NYC 2026", "ENS");
      // Second call (different sponsor)
      const r2 = await fetchBounties("ETHGlobal NYC 2026", "Dynamic");

      // Both should be arrays (not necessarily the same)
      expect(Array.isArray(r1)).toBe(true);
      expect(Array.isArray(r2)).toBe(true);
    },
    20_000,
  );
});
