# unbounded-mint

Pattern: an `_mint` or `mint` function callable by owner/admin with no cap on total supply.

Detection (parse_ast surface):
- function named `mint`, `_mint`, `airdrop`, `gift`, `reward`, etc.
- visibility public/external
- guarded by `onlyOwner` / `require(msg.sender == owner)` — but no `require(totalSupply + amount <= MAX_SUPPLY)` check
- often paired with arbitrary `to` address parameter

Why it's a 9-10:
- Owner can mint to themselves at any time, dump on liquidity pool, drain holders' value.
- Even if owner SEEMS trustworthy, key compromise = same outcome.
- Renouncing ownership is the only real fix — and most rug authors don't.

Soft variant (drop to 6-7): mint exists but has time-lock or DAO governance. The dump path requires forewarning.

Hard exclusion (drop to 2-3): no mint at all (immutable supply baked into constructor). The literal answer when reading parse_ast: total functions named `mint` or `_mint` callable post-deploy = 0.
