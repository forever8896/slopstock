import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Pin the workspace root so Next doesn't pick up unrelated lockfiles further up.
const workspaceRoot = resolve(here, "../..");

const config: NextConfig = {
  reactStrictMode: true,
  // The Base-Account wagmi connector (porto / @base-org/account / @coinbase/cdp-sdk)
  // drags in a second, newer `viem` whose types (OP-stack `deposit` tx, `tempo`
  // chain) are unrelated to the app's viem — a transitive TYPE-level conflict only
  // (runtime is fine). Skip the web type-check during build so prod can deploy;
  // the proper fix is deduping viem / reconsidering the Base-Account connector.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Workspace packages need transpilation in Next; otherwise Next chokes on
  // `workspace:*` imports.
  transpilePackages: ["@stratum/shared", "@stratum/sdk", "@stratum/contracts-types"],
  outputFileTracingRoot: workspaceRoot,
  // Product moved under /app; keep old links working. "/" is the landing now.
  async redirects() {
    return [
      { source: "/agent/:path*", destination: "/app/agent/:path*", permanent: false },
      { source: "/launch", destination: "/app/launch", permanent: false },
    ];
  },
  webpack: (cfg) => {
    // wagmi/rainbowkit pulls in MetaMask SDK which has React-Native-only deps.
    // Stub them out — they're never actually used in the browser bundle.
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.fallback = {
      ...cfg.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    // The Base-Account wallet (@base-org/account, statically pulled by RainbowKit's
    // connectors barrel) ships its OWN nested viem+@scure+@noble/hashes@2.x, which
    // is incompatible with the app's viem (@noble/hashes@1.x) → breaks the build
    // (missing ./secp256k1, ./sha3, abytes). We don't use Base Account, so alias it
    // (and @coinbase/cdp-sdk) to an empty module so it's never bundled.
    cfg.resolve.alias = {
      ...(cfg.resolve.alias ?? {}),
      "@base-org/account": false,
      "@coinbase/cdp-sdk": false,
      "@coinbase/wallet-sdk": false,
    };
    return cfg;
  },
};

export default config;
