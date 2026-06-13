import { describe, expect, test } from "bun:test";

import { createAgentPayFetch, exaSearch, formatHits, parseExaResults } from "./x402-outbound";

describe("parseExaResults", () => {
  test("maps Exa's results into SearchHits", () => {
    const hits = parseExaResults({
      results: [
        { title: "Reentrancy in X", url: "https://a.com", text: "The bug is..." },
        { title: "SWC-107", url: "https://b.com" },
      ],
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ title: "Reentrancy in X", url: "https://a.com", snippet: "The bug is..." });
    expect(hits[1]?.snippet).toBeUndefined();
  });

  test("returns [] for a malformed/empty response", () => {
    expect(parseExaResults({})).toEqual([]);
    expect(parseExaResults(null)).toEqual([]);
  });
});

describe("formatHits", () => {
  test("renders a numbered block", () => {
    const out = formatHits([{ title: "T", url: "https://u", snippet: "s" }]);
    expect(out).toContain("1. T");
    expect(out).toContain("https://u");
  });

  test("handles no results", () => {
    expect(formatHits([])).toBe("No results.");
  });
});

describe("exaSearch", () => {
  test("posts the query and returns parsed hits (stub payFetch)", async () => {
    let captured: { url: string; body: string } | null = null;
    const stubPayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), body: String(init?.body ?? "") };
      return new Response(JSON.stringify({ results: [{ title: "hit", url: "https://x" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const hits = await exaSearch(stubPayFetch, "reentrancy exploit", 2);
    expect(captured!.url).toContain("api.exa.ai/search");
    expect(captured!.body).toContain("reentrancy exploit");
    expect(hits[0]?.title).toBe("hit");
  });

  test("throws on a non-ok response", async () => {
    const stub = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(exaSearch(stub, "q")).rejects.toThrow(/exa search failed: 500/);
  });
});

describe("createAgentPayFetch", () => {
  test("returns a callable fetch wrapper", () => {
    // a throwaway viem account shape is enough to construct the client
    const fakeAccount = { address: "0x1111111111111111111111111111111111111111", signTypedData: async () => "0x" } as never;
    const payFetch = createAgentPayFetch(fakeAccount);
    expect(typeof payFetch).toBe("function");
  });
});
