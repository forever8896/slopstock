/**
 * Real ENS resolution against Sepolia for `*.slopstock.eth` agent subnames.
 *
 * Each Slopstock agent owns a subname under `slopstock.eth` (registered
 * 2026-05-03 on Sepolia ENS, deployer
 * `0x2908209845Edd4B526B9F26E3b3bba73E9A59D10`). The PublicResolver `addr`
 * record points at the agent's `RevenueVault` on Base Sepolia, so a successful
 * `getEnsAddress(name)` followed by an equality check against the local vault
 * address is a cryptographic binding between the on-chain ENS record and the
 * agent's identity.
 *
 * Verification is done at SSR time and surfaced in the agent header. If the
 * Sepolia RPC is unreachable, we degrade to "unknown" rather than failing the
 * page render — ENS is a verification overlay, not a load-bearing dependency
 * on the read path (the local map already has the right addresses).
 */

import { sepoliaPublicClient } from "./chain";

export type EnsVerification =
  | { ok: true; resolvedAddr: `0x${string}` }
  | { ok: false; reason: "unresolved" | "mismatch" | "rpc-error"; resolvedAddr?: `0x${string}` };

const ENS_PUBLIC_RESOLVER_SEPOLIA = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;

export async function verifyEns(
  ensName: string,
  expectedAddr: `0x${string}`,
): Promise<EnsVerification> {
  if (!ensName.toLowerCase().endsWith(".eth")) {
    return { ok: false, reason: "unresolved" };
  }
  try {
    const resolvedAddr = await sepoliaPublicClient.getEnsAddress({ name: ensName.toLowerCase() });
    if (!resolvedAddr) return { ok: false, reason: "unresolved" };
    if (resolvedAddr.toLowerCase() !== expectedAddr.toLowerCase()) {
      return { ok: false, reason: "mismatch", resolvedAddr };
    }
    return { ok: true, resolvedAddr };
  } catch {
    return { ok: false, reason: "rpc-error" };
  }
}

/** Sepolia Etherscan link to the resolver record for an ENS name. */
export function ensResolverEtherscanUrl(ensName: string): string {
  // The resolver-record viewer doesn't have a direct deep link, so we link to
  // the PublicResolver contract page. Once on the page judges can call
  // `addr(bytes32)` with the namehash to confirm.
  return `https://sepolia.etherscan.io/address/${ENS_PUBLIC_RESOLVER_SEPOLIA}#readContract`;
}

/** App.ENS.domains profile URL for the subname (works on Sepolia). */
export function ensAppUrl(ensName: string): string {
  return `https://sepolia.app.ens.domains/${ensName}`;
}
