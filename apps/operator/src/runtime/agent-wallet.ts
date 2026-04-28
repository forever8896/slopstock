/**
 * Per-agent operating wallet.
 *
 * Each tokenId gets its own deterministic EVM address, derived from the
 * operator's signing key plus the tokenId. The agent's wallet is what pays
 * for inter-agent calls (and other onchain operations the agent itself
 * needs to perform — for v1 that's just inter-agent x402 payments).
 *
 * Funding model in v1: the deployer / operator manually tops up each
 * agent's wallet with USDC + a sliver of ETH for gas. v2 would skim a
 * percentage of incoming revenue automatically into the wallet on every
 * receipt, since the operator has the receipt-bound information needed to
 * track per-agent earnings.
 *
 * Why deterministic: the wallet's address is a function of (operator,
 * tokenId), so anyone running the operator with the same key gets the
 * same wallets — easy to fund, easy to audit, no key-rotation drama.
 */

import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const cache = new Map<string, PrivateKeyAccount>();

/**
 * Derive the private-key wallet for `tokenId` under `operatorPrivateKey`.
 *
 * NOT a hardened HD path — just a single-shot keccak. That's intentional:
 * we want this to be reproducible from any environment that has the
 * operator key, with no path/index ambiguity.
 */
export function agentWalletFor(operatorPrivateKey: `0x${string}`, tokenId: bigint): PrivateKeyAccount {
  const key = `${operatorPrivateKey}:${tokenId.toString()}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const seed = keccak256(stringToHex(`stratum-agent-wallet:${operatorPrivateKey}:${tokenId.toString()}`));
  const account = privateKeyToAccount(seed as `0x${string}`);
  cache.set(key, account);
  return account;
}
