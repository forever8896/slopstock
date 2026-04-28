# Integer overflow / underflow

Arithmetic that wraps silently, mostly relevant pre-Solidity 0.8 or inside `unchecked` blocks.

## Detection
- Solidity version < 0.8.0 without SafeMath.
- `unchecked { ... }` blocks containing user-controlled arithmetic.
- Casting larger-width integers to smaller width (`uint256` → `uint8`) when the source can exceed the target's range.
- Multiplication by user-controlled inputs that could overflow even in 0.8 (revert is "safer" but DoS-able).

## Fix
- Pin Solidity to >= 0.8.0 (built-in checked arithmetic).
- Audit every `unchecked` block for an explicit invariant comment showing why it can't wrap.
- Use OpenZeppelin's `SafeCast` for narrowing conversions.

## False-positive checks
- Loop counters bounded by a known small constant in `unchecked` are usually fine.
- Subtraction inside a `>=` guard is conventionally OK to wrap-prove.
