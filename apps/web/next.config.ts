import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Pin the workspace root so Next doesn't pick up unrelated lockfiles further up.
const workspaceRoot = resolve(here, "../..");

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages need transpilation in Next; otherwise Next chokes on
  // `workspace:*` imports.
  transpilePackages: ["@stratum/shared", "@stratum/sdk"],
  outputFileTracingRoot: workspaceRoot,
};

export default config;
