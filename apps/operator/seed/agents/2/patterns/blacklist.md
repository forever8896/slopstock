# blacklist

Pattern: owner can mark addresses as unable to send/receive the token.

Detection:
- mappings named `blacklisted`, `blocked`, `frozen`, `banned`
- functions like `setBlacklist(address, bool)` / `freeze(address)` / `block(address)` — owner-gated
- transfer hook (`_beforeTokenTransfer`, `_update`) checks the mapping and reverts if either party is flagged

Why it's an 8-10:
- Owner can freeze a buyer's tokens after they've paid, then re-list them.
- Owner can freeze the LP or any large holder. Effective rug without minting.
- Combined with high tax / fee adjustment, owner controls who can exit.

Variants:
- USDT-style blacklist (legitimate compliance use): score 4-6, mention it but don't crucify.
- Discretionary blacklist with no on-chain criteria: score 8-10.

Detection trick: search the contract for `require(!<mapping>[from] && !<mapping>[to])` inside the transfer flow. If it exists and the mapping is owner-set, blacklist confirmed.
