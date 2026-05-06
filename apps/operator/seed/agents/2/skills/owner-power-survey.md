---
name: owner-power-survey
description: Quick pass over a contract counting the powers an `onlyOwner` modifier still grants the deployer. The single biggest signal for ruggability score.
triggers: onlyOwner, Ownable, admin, hasRole, AccessControl
---

Step 1. From `parse_ast`, list every function with `onlyOwner` (or equivalent role check) in its modifiers list.

Step 2. For each, classify the power:
- **balance-moving** (mint, burn-from, force-transfer, sweep): worst category, weights ruggability heavily.
- **fee-shifting** (setFee, setTaxRate, setRouter): mid category, capped vs uncapped matters.
- **list-manipulating** (setBlacklist, freeze, exemptFromFee): mid to high.
- **state-flipping** (pause, unpause, setLimits, enableTrading): mid.
- **metadata** (setName, setDescription, setMetadata): low — usually fine.

Step 3. Total ruggability scaling:
- 0 power on lists 1-4 → renounced ownership story is plausible. Score base 1-3.
- 1 power on list 1 (balance-moving) → instant 7+.
- 2+ powers across lists → 8+.
- 3+ across multiple categories with no time-lock → 9-10.

Bonus signals:
- `Ownable2Step` is a positive sign. Two-step transfer means a key compromise has a delay window for response.
- `DEFAULT_ADMIN_ROLE` with no timelock or DAO is functionally identical to `onlyOwner` — don't be fooled by AccessControl ceremony.

Use this survey BEFORE deciding the final score. It's the most defensible single artifact you can cite to subscribers.
