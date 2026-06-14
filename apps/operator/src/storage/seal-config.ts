/**
 * seal-config.ts — pure, SDK-free resolution of Seal network configuration.
 *
 * Kept separate from seal.ts so this logic is unit-testable WITHOUT importing
 * @mysten/seal (a heavy module with native-crypto deps). seal.ts re-exports
 * these for back-compat.
 */

export type SealNetwork = "testnet" | "mainnet";

/**
 * Canonical Mysten Labs open-mode key servers (verified-independent, Open mode).
 * Source: Seal docs Pricing page — "Verified key servers". These match the IDs that
 * the removed getAllowlistedKeyServers('testnet') helper used to return.
 *
 * Mainnet is intentionally empty: Seal mainnet is GA, but operators choose their own
 * verified key servers (and pin a version), so mainnet MUST set SEAL_KEY_SERVERS. Get the
 * current mainnet object IDs from the Seal "Verified Key Servers" docs page; use an open-mode
 * server, or a permissioned one after the provider allowlists your SEAL_PACKAGE_ID.
 */
export const MYSTEN_OPEN_KEY_SERVERS: Record<SealNetwork, string[]> = {
  testnet: [
    "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", // mysten-testnet-1
    "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", // mysten-testnet-2
  ],
  mainnet: [],
};

/**
 * Resolve the Seal key-server object IDs for a network. An explicit comma-separated
 * SEAL_KEY_SERVERS list always wins; otherwise fall back to the baked-in defaults
 * (testnet only). Throws on mainnet with no explicit list — there is no safe default.
 */
export function resolveKeyServerIds(network: SealNetwork, raw: string | undefined): string[] {
  const explicit = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;
  const baked = MYSTEN_OPEN_KEY_SERVERS[network];
  if (baked.length === 0) {
    throw new Error(
      `SealCipher: no key servers for network "${network}" — set SEAL_KEY_SERVERS ` +
        `(comma-separated key-server object IDs from the Seal "Verified Key Servers" docs page)`,
    );
  }
  return baked;
}

/**
 * Resolve whether the SealClient should cryptographically verify each key server.
 * Default: TRUE on mainnet (production integrity), FALSE on testnet (dev ergonomics).
 * Override with SEAL_VERIFY_KEY_SERVERS = true|false|1|0.
 */
export function resolveVerifyKeyServers(network: SealNetwork, raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return network === "mainnet";
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw new Error(`SealCipher: SEAL_VERIFY_KEY_SERVERS must be true|false|1|0 (got "${raw}")`);
}
