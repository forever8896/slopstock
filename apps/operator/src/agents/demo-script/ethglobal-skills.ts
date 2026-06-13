/**
 * Step 2b — ethglobal-skills tools (free-tier only)
 *
 * Data source: https://ethglobalskills.vercel.app
 *   GET /api/prizes?event=&sponsor=     — bounty text + qualifications
 *   GET /api/projects?event=&keyword=   — finalist/winner precedents
 *   GET /api/sponsors?keyword=          — sponsor enumeration
 *
 * Rate: 10 free req/min, then 402 → $0.05 USDC.
 *
 * ⚠️ PAID PATH IS BROKEN (HTTP 500 as of 2026-06-13) — see spec note.
 * We treat this as a FREE-TIER DATA SOURCE ONLY:
 *   - plain fetch (no x402)
 *   - session cache keyed by (event, sponsor) or (keyword, event)
 *   - soft-fail to [] on ANY non-200 or network error
 *   - respect ≤10 req/min (we cache aggressively to stay under)
 *
 * The paid path flag exists but is default OFF.
 */

const BASE_URL = "https://ethglobalskills.vercel.app";

export interface Bounty {
  title: string;
  description: string;
  qualifications?: string;
  sponsor?: string;
  event?: string;
  amount?: string | number;
  [key: string]: unknown;
}

export interface ProjectRecord {
  title: string;
  description?: string;
  event?: string;
  prizes?: string[];
  winner?: boolean;
  finalist?: boolean;
  [key: string]: unknown;
}

// ─── Session cache ─────────────────────────────────────────────────────────

const _bountyCache = new Map<string, Bounty[]>();
const _winnerCache = new Map<string, ProjectRecord[]>();

/** Clear caches (useful between test runs). */
export function clearSkillsCache(): void {
  _bountyCache.clear();
  _winnerCache.clear();
}

// ─── Rate-limit tracking (best-effort, not strict) ─────────────────────────

let _reqTimestamps: number[] = [];
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function _checkRateLimit(): void {
  const now = Date.now();
  _reqTimestamps = _reqTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (_reqTimestamps.length >= RATE_LIMIT_MAX) {
    console.warn(
      `[ethglobal-skills] rate limit: ${_reqTimestamps.length} req in last 60s — skipping to protect free tier`,
    );
    throw new Error("rate_limit");
  }
  _reqTimestamps.push(now);
}

// ─── Internal fetch helper ─────────────────────────────────────────────────

async function _fetchJson(url: string): Promise<unknown> {
  _checkRateLimit();

  const version = "1"; // X-Skill-Version to watch for
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "slopstock-demo-agent/1.0" },
    });
  } catch (err) {
    console.warn(`[ethglobal-skills] network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  // Log version header so we notice if a new version ships mid-event
  const skillVersion = res.headers.get("X-Skill-Version");
  if (skillVersion && skillVersion !== version) {
    console.warn(`[ethglobal-skills] X-Skill-Version=${skillVersion} (expected ${version}) — check API for breaking changes`);
  }

  if (!res.ok) {
    console.warn(`[ethglobal-skills] non-200 response: ${res.status} ${res.statusText} for ${url}`);
    return null;
  }

  try {
    return await res.json();
  } catch {
    console.warn(`[ethglobal-skills] failed to parse JSON from ${url}`);
    return null;
  }
}

// ─── fetchBounties ──────────────────────────────────────────────────────────

/**
 * Fetch bounty records for a (event, sponsor) pair.
 * Soft-fails to [] on any error.
 * Caches per session to stay inside the free tier.
 */
export async function fetchBounties(event: string, sponsor?: string): Promise<Bounty[]> {
  const cacheKey = `${event}:::${sponsor ?? ""}`;
  if (_bountyCache.has(cacheKey)) {
    return _bountyCache.get(cacheKey)!;
  }

  const params = new URLSearchParams({ event });
  if (sponsor) params.set("sponsor", sponsor);
  const url = `${BASE_URL}/api/prizes?${params.toString()}`;

  let result: unknown;
  try {
    result = await _fetchJson(url);
  } catch {
    _bountyCache.set(cacheKey, []);
    return [];
  }

  if (!result) {
    _bountyCache.set(cacheKey, []);
    return [];
  }

  // Parse — the API may return an array or { prizes: [...] } or { data: [...] }
  let raw: unknown[];
  if (Array.isArray(result)) {
    raw = result;
  } else if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;
    raw = Array.isArray(obj["prizes"]) ? (obj["prizes"] as unknown[]) :
          Array.isArray(obj["data"]) ? (obj["data"] as unknown[]) :
          [];
  } else {
    raw = [];
  }

  const bounties = raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r): Bounty => ({
      title: String(r["title"] ?? r["name"] ?? "(untitled)"),
      description: String(r["description"] ?? ""),
      qualifications: typeof r["qualifications"] === "string" ? r["qualifications"] : undefined,
      sponsor: typeof r["sponsor"] === "string" ? r["sponsor"] : sponsor,
      event: typeof r["event"] === "string" ? r["event"] : event,
      amount: r["amount"] ?? r["prize"] ?? undefined,
      ...r,
    }));

  _bountyCache.set(cacheKey, bounties);
  return bounties;
}

// ─── searchWinners ──────────────────────────────────────────────────────────

/**
 * Search for past winner/finalist projects matching keyword + event.
 * Soft-fails to [] on any error.
 * Caches per session.
 */
export async function searchWinners(
  keyword: string,
  event?: string,
  limit = 5,
): Promise<ProjectRecord[]> {
  const cacheKey = `${keyword}:::${event ?? ""}:::${limit}`;
  if (_winnerCache.has(cacheKey)) {
    return _winnerCache.get(cacheKey)!;
  }

  const params = new URLSearchParams({ keyword, limit: String(limit) });
  if (event) params.set("event", event);
  const url = `${BASE_URL}/api/projects?${params.toString()}`;

  let result: unknown;
  try {
    result = await _fetchJson(url);
  } catch {
    _winnerCache.set(cacheKey, []);
    return [];
  }

  if (!result) {
    _winnerCache.set(cacheKey, []);
    return [];
  }

  let raw: unknown[];
  if (Array.isArray(result)) {
    raw = result;
  } else if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;
    raw = Array.isArray(obj["projects"]) ? (obj["projects"] as unknown[]) :
          Array.isArray(obj["data"]) ? (obj["data"] as unknown[]) :
          [];
  } else {
    raw = [];
  }

  const projects = raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .slice(0, limit)
    .map((r): ProjectRecord => ({
      title: String(r["title"] ?? r["name"] ?? "(untitled)"),
      description: typeof r["description"] === "string" ? r["description"] : undefined,
      event: typeof r["event"] === "string" ? r["event"] : event,
      prizes: Array.isArray(r["prizes"]) ? (r["prizes"] as string[]) : undefined,
      winner: typeof r["winner"] === "boolean" ? r["winner"] : undefined,
      finalist: typeof r["finalist"] === "boolean" ? r["finalist"] : undefined,
      ...r,
    }));

  _winnerCache.set(cacheKey, projects);
  return projects;
}

// ─── OpenAI-style tool definitions ─────────────────────────────────────────

export const FETCH_BOUNTIES_TOOL = {
  type: "function" as const,
  function: {
    name: "fetch_bounties",
    description:
      "Fetch the actual bounty requirements and prize text for a sponsor at an ETHGlobal event. " +
      "Use this to ground your callouts in real sponsor criteria rather than guessing.",
    parameters: {
      type: "object",
      properties: {
        event: {
          type: "string",
          description: "ETHGlobal event name (e.g. 'ETHGlobal NYC 2026', 'ETHGlobal Bangkok')",
        },
        sponsor: {
          type: "string",
          description: "Sponsor name (e.g. 'ENS', 'Walrus', 'Dynamic'). Omit to get all sponsors.",
        },
      },
      required: ["event"],
    },
  },
};

export const SEARCH_WINNERS_TOOL = {
  type: "function" as const,
  function: {
    name: "search_winners",
    description:
      "Search past ETHGlobal finalist and winner projects matching a keyword. " +
      "Use this to cite real precedents when explaining why a project qualifies for a bounty.",
    parameters: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Keyword to search (e.g. 'storage', 'identity', 'payments')",
        },
        event: {
          type: "string",
          description: "Optional: filter by event name",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 5)",
        },
      },
      required: ["keyword"],
    },
  },
};
