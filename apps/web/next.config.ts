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
  transpilePackages: ["@stratum/shared", "@stratum/sdk", "@stratum/contracts-types"],
  outputFileTracingRoot: workspaceRoot,
  webpack: (cfg) => {
    // wagmi/rainbowkit pulls in MetaMask SDK which has React-Native-only deps.
    // Stub them out — they're never actually used in the browser bundle.
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.fallback = {
      ...cfg.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return cfg;
  },
};

export default config;
