# Signature replay

A signed message can be re-used across calls, contracts, or chains because the signed payload doesn't bind enough context.

## Detection
- `ecrecover` of a hash that doesn't include a nonce, deadline, or the contract's own address.
- Signatures used cross-chain without `block.chainid` in the digest.
- Nonces stored but never incremented after consumption.
- Missing `s` value range check (lower-half-of-curve enforcement) — accepts both `s` and `n - s`, doubling valid signatures (malleability).

## Fix
- EIP-712 typed-data signing: domain separator binds chain id + verifying contract + name + version.
- Per-user nonces that are incremented on each consume.
- A `deadline` timestamp.
- Use OpenZeppelin's `ECDSA.recover` (rejects high-`s` malleability) and `EIP712` helper.

## False-positive checks
- A one-shot signature whose payload includes a unique-by-design ID (e.g., a freshly minted tokenId) is naturally non-replayable.
- Signatures that gate read-only functions don't need replay protection.
