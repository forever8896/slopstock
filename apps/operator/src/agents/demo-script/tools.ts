/**
 * Step 2 — read_file tool for the demo-script agent.
 *
 * Proven tool-calling path from smoke-0g-tool-calling.ts: the model emits
 * read_file({ path: "README.md" }) without hints. We handle the call here,
 * fetching the actual file content from GitHub.
 */

const GITHUB_API = "https://api.github.com";
const MAX_FILE_BYTES = 100 * 1024; // 100KB

function githubHeaders(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"];
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "slopstock-demo-agent/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** OpenAI-style tool definition for read_file. */
export const READ_FILE_TOOL = {
  type: "function" as const,
  function: {
    name: "read_file",
    description:
      "Read a file from the GitHub repo by its repo-relative path. " +
      "Use this to examine the README, contracts, entry points, or any other file " +
      "that helps you understand what the project does.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repo-relative file path (e.g. README.md, contracts/Vault.sol)",
        },
      },
      required: ["path"],
    },
  },
};

/**
 * Handle a read_file tool call.
 * Returns decoded string content, or a soft "[file not found: <path>]" so the
 * model can recover without crashing the loop.
 *
 * @param owner   GitHub owner (from digestRepo)
 * @param repo    GitHub repo name
 * @param path    File path (leading `/` is normalised away)
 * @param ref     Git SHA or branch ref
 */
export async function handleReadFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  // Normalise: strip leading slashes
  const normPath = path.replace(/^\/+/, "");

  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${normPath}?ref=${encodeURIComponent(ref)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: githubHeaders() });
    // GitHub rate-limit (403 without auth, or 429) — retry once after a brief wait
    if ((res.status === 403 || res.status === 429) && !res.url.includes("raw.githubusercontent")) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await fetch(url, { headers: githubHeaders() });
    }
  } catch {
    return `[file not found: ${normPath}]`;
  }

  if (res.status === 404) return `[file not found: ${normPath}]`;
  if (!res.ok) return `[file not found: ${normPath}]`;

  const data = (await res.json()) as { content?: string; encoding?: string; size?: number };

  if (data.encoding !== "base64" || !data.content) {
    return `[file not found: ${normPath}]`;
  }

  const raw = Buffer.from(data.content.replace(/\n/g, ""), "base64");

  if (raw.length > MAX_FILE_BYTES) {
    return raw.slice(0, MAX_FILE_BYTES).toString("utf-8") + "\n[truncated]";
  }

  return raw.toString("utf-8");
}
