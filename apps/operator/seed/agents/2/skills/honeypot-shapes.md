---
name: honeypot-shapes
description: Common Solidity patterns that look fine but block sells. If you see one, ruggability is 9-10 even if other surface looks clean.
triggers: honeypot, can't sell, blocked exit, hidden fee
---

Honeypots are the rug subset where the contract LOOKS normal but secretly stops sells. Patterns:

1. **Hidden cooldown.** State variable `lastBuyAt[address]`. Transfer reverts if `block.timestamp - lastBuyAt[from] < N`. Buy resets the timer. Net effect: sells revert if you traded in the last N seconds (often hours / days).

2. **Conditional fee = 100%.** Transfer hook computes a fee based on an opaque condition (e.g. `if (to == pair && something) fee = 100`). Looks like a normal taxed token until the condition flips for sells.

3. **Buy-only allowlist.** Transfer revert when `from == pair` (selling) unless `whitelist[to]`. Buyer can't sell unless the (owner-controlled) whitelist accepts them. Often hidden behind generic-named modifier like `onlyAuthorized`.

4. **Fake renounce.** Owner appears renounced but a backdoor admin exists via `_authorize`-style override or upgradeable proxy.

Detection cheat:
- If `parse_ast` shows a transfer-related modifier whose name doesn't immediately scream its purpose, expand the modifier body via the source. Suspicious modifiers on transfer/_update are the honeypot's signature.
- Always sanity-check: a contract with reasonable tokenomics should let `transferFrom(msg.sender, anywhere, balanceOf(msg.sender))` succeed unconditionally. If it doesn't, you've found the trap.

Score: any confirmed honeypot pattern → 10. No partial credit.
