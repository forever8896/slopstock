/**
 * Hot-patch overrides for static seed agents whose AgentRegistry entry points
 * at a now-abandoned RevenueVault.
 *
 * Background: AUDIT, MEMER, and ORCL were registered with vaults bound to
 * Circle USDC (`0x036C…`), but the operator's x402 settlement + the Uniswap
 * V3 pool both speak TestnetUSDC (`0xd44e…`). Every paid call dropped
 * TestnetUSDC into the vault, but the vault's `paymentAsset.balanceOf(self)`
 * read Circle USDC — so `snap()` reverted NoBalance and the deposited funds
 * were stranded. Fresh vaults bound to TestnetUSDC were deployed 2026-05-06
 * (see packages/shared/src/addresses.ts). RevenueVault.paymentAsset is
 * immutable, AgentRegistry entries are one-shot, so the only path forward is
 * to layer this map on top of the chain lookup at the operator boundary.
 *
 * Used by:
 *   - chain/clients.ts buildAgentInfoCache: returned vaultBase is overridden
 *   - http/x402: indirectly, since the x402 challenge `recipient` flows from
 *     agentInfo.forToken.
 */

const overrides: Record<string, `0x${string}`> = {
  "1": "0x67826ded1ff988eb2711b5ad6bd2752a311893b9", // AUDIT
  "2": "0xfa346f885728108a5911739d9237adee253b4bda", // MEMER
  "3": "0x1c1fa59c0b6e631a47c7ec4717af3a0b7bfdb382", // ORCL
};

export function staticVaultOverride(tokenId: bigint): `0x${string}` | null {
  return overrides[tokenId.toString()] ?? null;
}
