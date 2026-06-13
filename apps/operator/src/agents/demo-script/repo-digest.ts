/**
 * Step 1 — GitHub Repo Digest
 *
 * Deterministic (no LLM) module that:
 *   - Fetches the full git tree from the GitHub REST API (unauthenticated or
 *     with GITHUB_TOKEN env var for higher rate limits).
 *   - Filters to interesting files (README*, package.json, *.sol, index.ts,
 *     main entry points) and excludes binary blobs.
 *   - Fetches content excerpts for the included files.
 *   - Returns a compact digest with a token-estimate < 4096.
 */

export class RepoNotFoundError extends Error {
  constructor(url: string) {
    super(`Repository not found (404): ${url}. Check that the URL is correct and the repo is public.`);
    this.name = "RepoNotFoundError";
  }
}

export class RepoPrivateError extends Error {
  constructor(url: string) {
    super(`Repository is private or requires authentication (403): ${url}. Only public repos are supported.`);
    this.name = "RepoPrivateError";
  }
}

export interface FileEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export interface ExcerptEntry {
  path: string;
  snippet: string;
}

export interface RepoDigest {
  owner: string;
  repo: string;
  sha: string;
  tree: FileEntry[];
  excerpts: ExcerptEntry[];
}

/**
 * Parse a GitHub URL into { owner, repo, ref? }.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 *   https://github.com/owner/repo/blob/branch/file
 */
export function parseGithubUrl(url: string): { owner: string; repo: string; ref?: string } {
  let cleaned = url.trim().replace(/\/$/, "");
  // Support git:// or ssh:// forms by converting to https
  cleaned = cleaned.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");

  const match = cleaned.match(/(?:^|[/:.@])github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?(?:\/|$)/) ||
                cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?(?:\/.*)?$/);
  if (!match) throw new RepoNotFoundError(url);
  return { owner: match[1]!, repo: match[2]!, ref: match[3] };
}

const GITHUB_API = "https://api.github.com";

function githubHeaders(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"];
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "slopstock-demo-agent/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Decide whether a file path is "interesting" enough to include in excerpts.
 * Keeps: README*, package.json, *.sol, index.ts, main.ts, Dockerfile,
 *        hardhat.config.*, foundry.toml, tsconfig.json, *.md (top-level only).
 * Excludes: binary extensions, lock files, build artifacts.
 */
export function isInteresting(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";

  // Exclude binaries and lock files
  const EXCLUDE_EXT = new Set([
    "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif",
    "woff", "woff2", "ttf", "eot",
    "lock", "sum",
    "zip", "tar", "gz", "tgz", "rar",
    "wasm", "bin", "so", "dylib", "dll",
    "pdf", "mp4", "mp3", "mov",
    "map",
  ]);
  if (EXCLUDE_EXT.has(ext)) return false;

  // Exclude common build/dep artifacts
  if (
    path.includes("node_modules/") ||
    path.includes(".git/") ||
    path.includes("dist/") ||
    path.includes(".next/") ||
    path.includes("out/") ||
    path.includes("coverage/") ||
    path.includes("artifacts/") ||
    path.includes("cache/") ||
    path.includes("typechain")
  ) return false;

  // Always include these
  if (/^readme(\.|$)/i.test(base)) return true;
  if (base === "package.json" && !path.includes("node_modules")) return true;
  if (ext === "sol") return true;
  if (base === "index.ts" || base === "index.js") return true;
  if (base === "main.ts" || base === "main.js") return true;
  if (base === "Dockerfile") return true;
  if (base === "docker-compose.yml" || base === "docker-compose.yaml") return true;
  if (base === "hardhat.config.ts" || base === "hardhat.config.js") return true;
  if (base === "foundry.toml") return true;
  if (base === "tsconfig.json" && path.split("/").length <= 2) return true;

  return false;
}

const EXCERPT_MAX_CHARS = 600; // ~150 tokens per file
const SNIPPET_TRUNCATE_CHARS = 500;

/**
 * Fetch repo digest from GitHub.
 * Throws RepoNotFoundError or RepoPrivateError on non-2xx responses.
 */
export async function digestRepo(githubUrl: string): Promise<RepoDigest> {
  const { owner, repo, ref } = parseGithubUrl(githubUrl);

  // Resolve the SHA for the ref (or default branch if no ref)
  let sha: string;
  const branchUrl = ref
    ? `${GITHUB_API}/repos/${owner}/${repo}/branches/${ref}`
    : `${GITHUB_API}/repos/${owner}/${repo}`;

  const infoRes = await fetch(
    ref ? `${GITHUB_API}/repos/${owner}/${repo}/commits/${ref}` : `${GITHUB_API}/repos/${owner}/${repo}`,
    { headers: githubHeaders() },
  );

  if (infoRes.status === 404) throw new RepoNotFoundError(githubUrl);
  if (infoRes.status === 403) throw new RepoPrivateError(githubUrl);
  if (!infoRes.ok) throw new RepoNotFoundError(githubUrl);

  const infoData = await infoRes.json() as Record<string, unknown>;

  if (ref) {
    // /repos/{owner}/{repo}/commits/{ref} returns a commit object
    sha = (infoData as { sha?: string }).sha ?? ref;
  } else {
    // /repos/{owner}/{repo} returns repo metadata with default_branch
    const defaultBranch = (infoData as { default_branch?: string }).default_branch ?? "main";
    const branchRes = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${defaultBranch}`,
      { headers: githubHeaders() },
    );
    if (branchRes.status === 404) throw new RepoNotFoundError(githubUrl);
    if (branchRes.status === 403) throw new RepoPrivateError(githubUrl);
    if (!branchRes.ok) throw new RepoNotFoundError(githubUrl);
    const branchData = await branchRes.json() as { sha?: string };
    sha = branchData.sha ?? defaultBranch;
  }

  // Fetch the recursive tree
  const treeRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: githubHeaders() },
  );
  if (treeRes.status === 404) throw new RepoNotFoundError(githubUrl);
  if (treeRes.status === 403) throw new RepoPrivateError(githubUrl);
  if (!treeRes.ok) throw new RepoNotFoundError(githubUrl);

  const treeData = await treeRes.json() as {
    tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>;
  };

  const tree: FileEntry[] = (treeData.tree ?? [])
    .filter((e) => e.path && e.sha)
    .map((e) => ({
      path: e.path!,
      type: (e.type === "tree" ? "tree" : "blob") as "blob" | "tree",
      size: e.size,
      sha: e.sha!,
    }));

  // Fetch excerpts for interesting files (cap total to stay under 4096 tokens)
  const interesting = tree.filter((e) => e.type === "blob" && isInteresting(e.path));
  const excerpts: ExcerptEntry[] = [];
  let totalChars = 0;

  // Prioritize: README first, then *.sol, then package.json, then the rest
  const priority = (p: string): number => {
    const base = p.split("/").pop() ?? p;
    if (/^readme/i.test(base)) return 0;
    if (p.endsWith(".sol")) return 1;
    if (base === "package.json") return 2;
    if (base === "index.ts" || base === "main.ts") return 3;
    return 4;
  };
  interesting.sort((a, b) => priority(a.path) - priority(b.path));

  for (const entry of interesting) {
    if (totalChars >= EXCERPT_MAX_CHARS * 5) break; // hard cap ~3000 chars total (~750 tokens)

    const contentRes = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${entry.path}?ref=${sha}`,
      { headers: githubHeaders() },
    );
    if (!contentRes.ok) continue;

    const data = await contentRes.json() as { content?: string; encoding?: string };
    if (data.encoding !== "base64" || !data.content) continue;

    const decoded = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    const snippet = decoded.slice(0, SNIPPET_TRUNCATE_CHARS);
    excerpts.push({ path: entry.path, snippet });
    totalChars += snippet.length;
  }

  return { owner, repo, sha, tree, excerpts };
}

/**
 * Rough token estimate: characters / 4.
 * Only counts the first 60 tree entries (what the prompt actually shows)
 * and all excerpt text.
 */
export function estimateTokens(digest: RepoDigest): number {
  const treeText = digest.tree.slice(0, 60).map((e) => e.path).join("\n");
  const excerptText = digest.excerpts.map((e) => `${e.path}\n${e.snippet}`).join("\n---\n");
  return Math.ceil((treeText.length + excerptText.length) / 4);
}
